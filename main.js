import fs from "fs";
import { Blob } from "buffer";

import core from "@actions/core";

import gitea from "gitea-api";
import path from 'path'

async function run() {
  try {
    const server_url = core.getInput("server_url")
    const name = core.getInput("name")
    const body = core.getInput("body")
    const tag_name = core.getInput("tag_name")
    const draft = Boolean(core.getInput("draft"))
    const prerelease = Boolean(core.getInput("prerelease"))
    const files = core.getInput("files")
    const repository = core.getInput("repository")
    const token = core.getInput("token")

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
    })
    const file_patterns = files.split('\n')
    const all_files = paths(file_patterns);
    if (all_files.length == 0) {
      console.warn(`${file_patterns} not include valid file.`);
    }
    await uploadFiles(gitea_client, owner, repo, response.id, all_files)
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
    return release
  } catch (error) {
    if (!(error instanceof gitea.ApiError) || error.status !== 404) {
      throw error
    }
  }
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
      glob.sync(pattern).filter((path) => statSync(path).isFile())
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
 */
async function uploadFiles(client, owner, repo, release_id, all_files) {
  const attachments = await client.repository.repoListReleaseAttachments({
    owner: owner,
    repo: repo,
    id: release_id,
  })
  for (const filepath in all_files) {
    for (const attachment in attachments) {
      if (attachment.name === path.basename(filepath)) {
        await client.repository.repoDeleteReleaseAttachment({
          owner: owner,
          repo: repo,
          id: id,
          attachmentId: attachment.id,
        })
        console.log(`Successfully deleted old release attachment ${attachment.name}`)
      }
      const content = fs.readFileSync(filepath);
      const blob = new Blob([content]);
      await client.repository.repoCreateReleaseAttachment({
        owner: owner,
        repo: repo,
        id: release_id,
        attachment: blob,
        name: path.basename(filepath),
      })
      console.log(`Successfully uploaded release attachment ${filepath}`)
    }
  }
}

run();
