import asyncfs from "node:fs/promises";
import fs from "fs";
import { Blob, File } from "buffer";
import * as glob from "glob";

import core from "@actions/core";

import gitea from "gitea-api";
import path from 'path';
import CryptoJS from 'crypto-js';

function getIsTrue(v) {
    const trueValue = ['true', 'True', 'TRUE']
    return trueValue.includes(v)
}

async function run() {
  try {
    const server_url = core.getInput("server_url")
    const name = core.getInput("name")
    const body = getReleaseBody(core.getInput("body"), core.getInput("body_path"))
    const tag_name = core.getInput("tag_name")
    const draft = getIsTrue(core.getInput("draft"))
    const prerelease = getIsTrue(core.getInput("prerelease"))
    const files = core.getInput("files")
    const repository = core.getInput("repository")
    const token = core.getInput("token")
    const target_commitish = core.getInput("target_commitish")
    const md5sum = getIsTrue(core.getInput("md5sum"))
    const sha256sum = getIsTrue(core.getInput("sha256sum"))

    const [owner, repo] = (repository).split("/")

    const gitea_client = new gitea.GiteaApi({
      BASE: `${server_url}/api/v1`,
      WITH_CREDENTIALS: true,
      TOKEN: token,
    });

    const response = await createOrGetRelease(gitea_client, owner, repo, {
      body: body,
      draft: draft,
      name: name,
      prerelease: prerelease,
      tag_name: tag_name,
      target_commitish: target_commitish,
    })
    const file_patterns = files.split('\n')
    const all_files = paths(file_patterns);
    if (all_files.length == 0) {
      console.warn(`${file_patterns} not include valid file.`);
    }
    await uploadFiles(gitea_client, owner, repo, response.id, all_files, {
      md5sum: md5sum,
      sha256sum: sha256sum,
    })
    console.log(`🎉 Release ready at ${response.html_url}`);
  } catch (error) {
    console.log(error);
    core.setFailed(error.message);
  }
}

/**
 * 
 * @param {gitea.GiteaApi} client 
 * @param {String} owner 
 * @param {String} repo 
 * @param {gitea.CreateReleaseOption} body
 * @returns {Promise<gitea.Release>}
 */
async function createOrGetRelease(client, owner, repo, body) {
  try {
    let release = await client.repository.repoGetReleaseByTag({
      owner: owner,
      repo: repo,
      tag: body.tag_name,
    })
    const release_id = release.id;
    let target_commitish = release.target_commitish;
    if (body.target_commitish && body.target_commitish !== release.target_commitish) {
      console.log(`Updating commit from "${release.target_commitish}" to "${body.target_commitish}"`);
    }
    target_commitish = body.target_commitish;
    release = client.repository.repoEditRelease({
      owner: owner,
      repo: repo,
      id: release_id,
      body: {
        body: body.body || release.body,
        draft: body.draft !== undefined ? body.draft : release.draft,
        name: body.name || release.name,
        prerelease: body.prerelease !== undefined ? body.prerelease : release.prerelease,
        tag_name: body.tag_name || release.tag_name,
        target_commitish: target_commitish,
      }
    })
    return release
  } catch (error) {
    if (!(error instanceof gitea.ApiError) || error.status !== 404) {
      throw error
    }
  }
  let commit_message = "";
  if (body.target_commitish) {
    commit_message = ` using commit "${body.target_commitish}"`;
  }
  console.log(`👩‍🏭 Creating new GitHub release for tag ${body.tag_name}${commit_message}...`);
  let release = await client.repository.repoCreateRelease({
    owner: owner,
    repo: repo,
    body: body,
  })
  return release
}

/**
 * 
 * @param {Array<String>} patterns 
 * @returns {Array<String>}
 */
function paths(patterns) {
  return patterns.reduce((acc, pattern) => {
    return acc.concat(
      glob.sync(pattern).filter((path) => fs.statSync(path).isFile())
    );
  }, []);
};

async function createStreamableFile(fpath) {
  const name = path.basename(fpath);
  const handle = await asyncfs.open(fpath);
  const { size } = await handle.stat();

  const file = new File([], name);
  file.stream = () => handle.readableWebStream();
  file.close = async () => await handle?.close();

  // Set correct size otherwise, fetch will encounter UND_ERR_REQ_CONTENT_LENGTH_MISMATCH
  Object.defineProperty(file, 'size', { get: () => size });

  return file;
}


async function calculateMultipleHashes(file, algorithms = ['md5', 'sha256']) {
    const stream = file.stream();
    const reader = stream.getReader();

    const hashers = algorithms.map(alg => {
        switch(alg.toLowerCase()) {
            case 'md5':
                return { name: 'md5', instance: CryptoJS.algo.MD5.create() };
            case 'sha1':
                return { name: 'sha1', instance: CryptoJS.algo.SHA1.create() };
            case 'sha256':
                return { name: 'sha256', instance: CryptoJS.algo.SHA256.create() };
            case 'sha512':
                return { name: 'sha512', instance: CryptoJS.algo.SHA512.create() };
            default:
                throw new Error(`not support hash: ${alg}`);
        }
    });
    
    try {
        while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
                break;
            }
            
            const wordArray = CryptoJS.lib.WordArray.create(value);

            hashers.forEach(hasher => {
                hasher.instance.update(wordArray);
            });
        }

        const result = {};
        hashers.forEach(hasher => {
            result[hasher.name] = hasher.instance.finalize().toString(CryptoJS.enc.Hex);
        });
        
        return result;
    } finally {
        reader.releaseLock();
    }
}


/**
 * 
 * @param {gitea.GiteaApi} client 
 * @param {String} owner 
 * @param {String} repo 
 * @param {Number} release_id 
 * @param {Array<String>} all_files 
 * @param {Map<String, Any>} additional parameters
 */
async function uploadFiles(client, owner, repo, release_id, all_files, params) {
  params = params || {};
  const attachments = await client.repository.repoListReleaseAttachments({
    owner: owner,
    repo: repo,
    id: release_id,
  })
  // deleted old release attachment
  const will_deleted = new Set();
  for (const filepath of all_files) {
    will_deleted.add(path.basename(filepath));
    if (params.md5sum) {
      will_deleted.add(`${path.basename(filepath)}.md5`);
    }
    if (params.sha256sum) {
      will_deleted.add(`${path.basename(filepath)}.sha256`);
    }
  }
  for (const attachment of attachments) {
    if (will_deleted.has(attachment.name)) {
      await client.repository.repoDeleteReleaseAttachment({
        owner: owner,
        repo: repo,
        id: release_id,
        attachmentId: attachment.id,
      })
      console.log(`Successfully deleted old release attachment ${attachment.name}`)
    }
  }
  // upload new release attachment
  for (const filepath of all_files) {
    let curfile = await createStreamableFile(filepath)
    await client.repository.repoCreateReleaseAttachment({
      owner: owner,
      repo: repo,
      id: release_id,
      attachment: curfile,
      name: path.basename(filepath),
    })
    await curfile.close();
    let algorithms = [];
    if (params.md5sum) {
      algorithms = algorithms.concat('md5');
    }
    if (params.sha256sum) {
      algorithms = algorithms.concat('sha256');
    }
    let hashes = {};
    if (algorithms.length !== 0) {
      curfile = await createStreamableFile(filepath)
      hashes = await calculateMultipleHashes(curfile, algorithms)
      await curfile.close();
    }
    if (params.md5sum) {
      let hash = hashes.md5;
      let blob = new Blob([hash], { type : 'plain/text' });
      await client.repository.repoCreateReleaseAttachment({
        owner: owner,
        repo: repo,
        id: release_id,
        attachment: blob,
        name: `${path.basename(filepath)}.md5`,
      })
    }
    if (params.sha256sum) {
      let hash = hashes.sha256;
      let blob = new Blob([hash], { type : 'plain/text' });
      await client.repository.repoCreateReleaseAttachment({
        owner: owner,
        repo: repo,
        id: release_id,
        attachment: blob,
        name: `${path.basename(filepath)}.sha256`,
      })
    }
    console.log(`Successfully uploaded release attachment ${filepath}`)
  }
}

function getReleaseBody(body, body_path) {
  return (
    (body_path && fs.readFileSync(body_path).toString("utf8")) || body
  )
}

run()
