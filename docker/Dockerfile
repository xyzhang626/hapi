# HAPI E2E sandbox image
#
# Base = Microsoft Playwright image: Chromium + system deps + Node 22 already
# baked in. Pinned to v1.59.x to match `package.json` `playwright: ^1.59.1`.
# The base image ships with `pwuser` (uid 1000), which we run as because
# `claude --dangerously-skip-permissions` refuses to execute as root.
# uid 1000 also matches the host's azureuser, so bind-mounted /workspace
# files end up host-owned correctly.
#
# On top: bun (HAPI runtime), claude CLI (agent), playwright-cli (test driver)
# + chrome-for-testing browser pre-installed.

FROM mcr.microsoft.com/playwright:v1.59.1-jammy

ENV DEBIAN_FRONTEND=noninteractive

# unzip is needed by the bun installer; everything else (curl, ca-certs, git)
# is already in the base image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/*

# Bun — install to /opt/bun (system-wide, NOT under /root which is 700 and
# blocks pwuser). Pin to the version the repo's bun.lock was generated
# against (matches host: 1.3.13).
ENV BUN_INSTALL=/opt/bun
ENV PATH=/opt/bun/bin:$PATH
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.13" \
    && ln -s /opt/bun/bin/bun /usr/local/bin/bun \
    && bun --version

# Claude Code CLI + Playwright CLI as global npm packages — both end up in
# /usr/lib/node_modules, world-readable, world-executable.
RUN npm install -g @anthropic-ai/claude-code @playwright/cli \
    && claude --version

# @playwright/cli wants the "chrome-for-testing" browser variant, which is
# NOT what the base image's pre-installed Chromium provides. Install it now
# so the first `playwright-cli open --browser chromium` doesn't error.
# /ms-playwright is already 777 on the base image so pwuser can read it.
RUN playwright-cli install-browser chrome-for-testing

# Per-container HAPI data directory, bind hub to all interfaces so the host
# can reach mapped ports. HOME=/home/pwuser so claude looks for
# .claude/settings.json there.
ENV HAPI_HOME=/data/.hapi \
    HAPI_LISTEN_HOST=0.0.0.0 \
    HAPI_LISTEN_PORT=3006 \
    HOME=/home/pwuser

# pwuser-owned mountpoints. /workspace is bind-mounted from the host
# (azureuser uid 1000 = pwuser uid 1000, no perm gymnastics). /data and
# /home/pwuser/.claude are container-private named volumes — Docker
# initializes named-volume ownership from the mountpoint dir's owner in
# the image, so we must mkdir + chown them BEFORE the VOLUME directive
# or pwuser won't be able to write at runtime.
#
# In find-mode the host bind-mounts /workspace as RO, so each workspace
# package's node_modules also needs a writable named volume mounted on
# top — same trick: pre-create the mountpoint as pwuser-owned so the
# volume inherits the right ownership on first attach.
RUN mkdir -p /workspace/node_modules /data /home/pwuser/.claude \
        /workspace/cli/node_modules \
        /workspace/hub/node_modules \
        /workspace/web/node_modules \
        /workspace/shared/node_modules \
        /workspace/website/node_modules \
        /workspace/docs/node_modules \
    && chown -R pwuser:pwuser /workspace /data /home/pwuser

WORKDIR /workspace

VOLUME ["/workspace/node_modules", "/data", "/home/pwuser/.claude"]

EXPOSE 3006 5173

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER pwuser

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
