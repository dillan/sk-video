# Changelog

All notable changes to **SK Video** are documented in this file. From the first release onward it is
maintained automatically by [semantic-release](https://github.com/semantic-release/semantic-release)
from [Conventional Commits](https://www.conventionalcommits.org/).

## Unreleased

- Plugin skeleton and a custom `cameras` Signal K resource provider (P1): validated camera
  definitions (stream-scheme allow-list + injection guards), a file-backed store in the plugin data
  directory, and a `GET /plugins/sk-video/status` endpoint.
