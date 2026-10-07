`chromium-seccomp.json` comes from Microsoft Playwright v1.62.0:
https://github.com/microsoft/playwright/blob/v1.62.0/utils/docker/seccomp_profile.json

Playwright is licensed under Apache-2.0:
https://github.com/microsoft/playwright/blob/v1.62.0/LICENSE

The profile retains Docker's syscall filter and permits the user namespaces needed by Chromium's sandbox. The container still runs as an unprivileged user, drops capabilities and uses no-new-privileges. Kernel support must be verified with the container smoke check; do not disable the browser sandbox to work around failures.

Local adaptation (2026-10-03): permit the `chroot` syscall without Docker's outer `CAP_SYS_CHROOT` condition. Chromium uses it to restrict its filesystem inside its own user namespace; kernel permission checks still apply and the container receives no additional capabilities. The stock condition prevented sandboxed Chromium from launching with `cap_drop: ALL`. Chromium implementation: https://chromium.googlesource.com/chromium/src/sandbox/+/refs/heads/main/linux/services/credentials.cc
