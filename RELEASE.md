## Adaptation to starknet-devnet

When adapting to a new [starknet-devnet](https://github.com/starknet-io/starknet-devnet) version, be sure to have replaced all occurrences of the previous version with the new one.

If possible, keep the semver of `starknet-devnet-js` the same as that of `starknet-devnet`.

### RPC compatibility

Make sure:

- the underlying Devnet is compatible with the starknet.js version configured in package.json
- `--fork-network` in [the CI workflow](.github/workflows/build-test-publish.yml) is using an up-to-date URL with the correct RPC version.

## New release

The release of a new version is done automatically if the version in `package.json` on `master` is different from the one on [npm](https://www.npmjs.com/package/starknet-devnet). If the semver you use is not of the form `/v?[0-9.]+$/` (notice the optional `v`), a pre-release will be made using dist-tag `beta`. Otherwise a dist-tag `latest` is used.

Follow these steps to create a new release on npm and GitHub:

1. `$ git checkout master`

    - Using another branch is only acceptable if making a pre-release, but then the publishing script needs to be run manually (or the CI config file needs to be modified to include your branch).

2. Update the package version and create a git tag

    - If the package version has already been incremented, just create a tag with `$ git tag <VERSION>`.
    - Otherwise run `$ npm version <NEW_VERSION>`. See what `<NEW_VERSION>` can be [here](https://docs.npmjs.com/cli/v8/commands/npm-version).

3. `$ git push`

    - Once the change is pushed, the CI/CD pipeline will release the new version when all tests pass.

4. `$ git push origin v<NEW_VERSION>`

    - Notice how the tag name has the `v` prefix.

Avoid the automatic release process by adding `[skip ci]` to your commit message.
