# port-who

> See what is using a port, then free it.

`port-who` answers one question without making you remember `lsof`, `netstat`, PowerShell, PIDs, or process-tree commands.

```console
$ npx port-who 3000
● Port 3000 is in use
  node · PID 41872 · alex
  listens  TCP 127.0.0.1:3000
  command  node server.js
  parent   npm (41855) ← zsh (39210)

You can kill it with port-who 3000 --kill
```

Then:

```console
$ npx port-who 3000 --kill
Stopping node (PID 41872)…
✓ Port 3000 is free. Stopped the listener.
```

## Use it

Run it without installing:

```sh
npx port-who 3000
npx port-who 3000 --kill
```

Or install it globally:

```sh
npm install --global port-who
port-who 3000
port-who 3000 --kill
```

The `--kill` option can come before or after the port. `-k` is its short form.

## What it does

- Finds TCP listeners and UDP bindings on the requested port.
- Shows the process, PID, owner, command, endpoints, and a compact parent trace.
- With `--kill`, stops the listener and all of its descendants.
- Tries a graceful stop first, waits briefly, and force-stops only processes that remain.
- Checks the port again before claiming that it is free.

That is the whole tool. It has no runtime dependencies, no configuration, and no telemetry.

## Platform support

| Platform | Discovery | Termination |
| --- | --- | --- |
| Linux | `/proc` socket and process data | `SIGTERM`, then `SIGKILL` if required |
| macOS | built-in `lsof` and `ps` | `SIGTERM`, then `SIGKILL` if required |
| Windows | PowerShell networking/CIM commands, with `netstat` fallback | `taskkill` process trees |

Node.js 18.18 or newer is required. The package contains JavaScript only and works across CPU architectures supported by Node.js.

You can inspect processes owned by other users only when the OS allows it. Stopping them may require an elevated terminal (`sudo` on macOS/Linux or Administrator on Windows).

## Options

```text
Usage
  port-who <port>
  port-who <port> --kill

Options
  -k, --kill     Stop the process and its descendants
  -h, --help     Show help
  -v, --version  Show the version
      --no-color Disable colors
```

`NO_COLOR=1` is also respected.

## Exit codes

- `0` — the query completed, or the port was successfully freed
- `1` — discovery or termination failed, or the port remained occupied
- `2` — the command line was invalid

## Development

```sh
npm install
npm test
npm run check
```

Tests include parser and CLI unit tests plus an end-to-end test against a real TCP listener. CI runs on Linux, macOS, and Windows.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Please report security issues using the private process in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
