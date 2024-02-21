# Gitea Release action

An action to support publishing release to Gitea.

## Inputs

The following are optional as `step.with` keys

| Name               | Type    | Description                                                                                         |
| ------------------ | ------- | --------------------------------------------------------------------------------------------------- |
| `server_url`       | String  | the base url of the gitea API. Defaults to `github.server_url`                                      |
| `body`             | String  | Text communicating notable changes in this release                                                  |
| `body_path`        | String  | Path to load text communicating notable changes in this release                                     |
| `draft`            | Boolean | Creates a draft release. Defaults to false                                                          |
| `prerelease`       | Boolean | Indicator of whether or not is a prerelease                                                         |
| `files`            | String  | Newline-delimited globs of paths to assets to upload for release                                    |
| `name`             | String  | Name of the release. Defaults to tag name                                                           |
| `tag_name`         | String  | Name of a tag. Defaults to `github.ref_name`                                                        |
| `repository`       | String  | Name of a target repository in `<owner>/<repo>` format. Defaults to `github.repository`             |
| `token`            | String  | Gitea Token. Defaults to `${{ github.token }}`                                                      |
| `target_commitish` | String  | Commitish value that determines where the Git tag is created from. Can be any branch or commit SHA. |

## Example usage

```yaml
uses: akkuman/gitea-release-action@v1
env:
  NODE_OPTIONS: '--experimental-fetch' # if nodejs < 18
with:
  files: |-
    bin/**
```

If you want to ignore ssl verify error, you can set env `NODE_TLS_REJECT_UNAUTHORIZED=false`

## References

- [softprops/action-gh-release: 📦 GitHub Action for creating GitHub Releases](https://github.com/softprops/action-gh-release)
- [sigyl-actions/gitea-action-release-asset](https://github.com/sigyl-actions/gitea-action-release-asset)
- [actions/release-action: An action written by Golang to support publishing release to Gitea(not Github Actions compatible) - release-action - Gitea: Git with a cup of tea](https://gitea.com/actions/release-action)
