# Contributing to Farm Hands

Thanks for helping improve the farm. Please follow the [code of conduct](CODE_OF_CONDUCT.md).

## Before you start

Check existing issues for similar work. For a larger change, open a feature request to discuss the player experience and scope before writing code. Do not post security vulnerabilities in public issues; follow [SECURITY.md](SECURITY.md).

## Local setup

1. Fork the repository and create a branch for your change.
2. Serve the repository root with `python3 -m http.server 8000` and open `http://localhost:8000`.
3. Change the first-party files in the repository root. The checked-in Three.js files under `vendor/three/` are third-party code.
4. Run `node --test tests/farming.test.mjs`, `node --check game.js`, `node --check calendar.js`, and `git diff --check`.
5. Test the change in a browser, including a fresh game and a saved game where relevant. Describe those steps in the pull request.

Please keep gameplay changes focused, preserve existing saves, and include text alternatives and keyboard access for new controls. Do not commit secrets, generated build files, or third-party assets without their license notices.

Contributors keep copyright in their original work. Before a substantial contribution is merged, the maintainer may need to confirm permission to include it in commercially distributed versions of Farm Hands. Discuss those terms in the pull request; opening a pull request alone does not transfer copyright.
