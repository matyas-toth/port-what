# Contributing to port-what

Thanks for helping make `port-what` better. The project deliberately has a narrow scope: identify what owns a port and, when asked, stop that process tree.

## Before opening an issue

- Search existing issues first.
- Do not report vulnerabilities in a public issue. Follow [SECURITY.md](SECURITY.md).
- Include your OS, architecture, Node.js version, command, output, and a minimal reproduction.

## Development setup

1. Fork and clone the repository.
2. Use Node.js 18.18 or newer.
3. Run `npm install`.
4. Create a focused branch.
5. Make the change and add or update tests.
6. Run `npm run check`.

There are intentionally no runtime dependencies. Please discuss adding one before opening a pull request.

## Pull requests

- Keep changes focused and explain the user-visible behavior.
- Add a line under `Unreleased` in [CHANGELOG.md](CHANGELOG.md) for user-visible changes.
- Test OS-specific changes on the relevant OS where possible.
- Do not include unrelated formatting or generated files.
- By contributing, you agree that your contribution is licensed under the MIT License.

All participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).
