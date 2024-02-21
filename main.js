import fs from "fs";
import { Blob } from "buffer";
import * as glob from "glob";

import core from "@actions/core";

import gitea from "gitea-api";
import path from 'path';
import CryptoJS from 'crypto-js';


async function run() {
  try {
    const server_url = core.getInput("server_url")
    const name = core.getInput("name")
    const body = getReleaseBody(core.getInput("body"), core.getInput("body_path"))
    const tag_name = core.getInput("tag_name")
    const draft = Boolean(core.getInput("draft"))
    const prerelease = Boolean(core.getInput("prerelease"))
    const files = core.getInput("files")
    const repository = core.getInput("repository")
    const token = core.getInput("token")
    const target_commitish = core.getInput("target_commitish")
    const md5sum = core.getInput("md5sum")
    const sha256sum = core.getInput("sha256sum")

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
  for (const filepath of all_files) {
    for (const attachment of attachments) {
      let will_deleted = [path.basename(filepath), `${path.basename(filepath)}.md5`, `${path.basename(filepath)}.sha256`]
      if (will_deleted.includes(attachment.name)) {
        await client.repository.repoDeleteReleaseAttachment({
          owner: owner,
          repo: repo,
          id: release_id,
          attachmentId: attachment.id,
        })
        console.log(`Successfully deleted old release attachment ${attachment.name}`)
      }
    }
    const content = fs.readFileSync(filepath);
    let blob = new Blob([content]);
    await client.repository.repoCreateReleaseAttachment({
      owner: owner,
      repo: repo,
      id: release_id,
      attachment: blob,
      name: path.basename(filepath),
    })
    if (params.md5sum) {
      let wordArray = CryptoJS.lib.WordArray.create(content);
      let hash = CryptoJS.MD5(wordArray).toString();
      blob = new Blob([hash], { type : 'plain/text' });
      await client.repository.repoCreateReleaseAttachment({
        owner: owner,
        repo: repo,
        id: release_id,
        attachment: blob,
        name: `${path.basename(filepath)}.md5`,
      })
    }
    if (params.sha256sum) {
      let wordArray = CryptoJS.lib.WordArray.create(content);
      let hash = CryptoJS.SHA256(wordArray).toString();
      blob = new Blob([hash], { type : 'plain/text' });
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
