# Contribution

# Git Flow 

In this fork, `develop` is the only working branch. `master` is upstream's old release branch of
built files, kept for history; nothing targets it.

# Pull request

Target your pull request on `develop`. PRs are squash-merged and the title is the Conventional
Commit release-please reads, so pick the type by what ships (`fix:` for a change to `src/`,
`chore:`/`ci:`/`test:` for anything that does not change the published files).

# How to build

1. Clone

2. Run

    ```sh
    npm install
    ```

3. Run

    ```sh
    npm run build
    ```

    This writes the published modules (`index.js`, `aes.js`, `enc-hex.js`, ...) into the package
    root. They are generated and ignored by git.

4. Run

    ```sh
    npm test
    ```

    This builds, checks the output against the crypto-js 4.2.0 tarball, and runs upstream's test
    suite on `node:test`.