# systemd --user units (Linux)

`install.sh` fills `{{HOME}}`/`{{NODE}}`/`{{REPO}}` and writes these into
`~/.config/systemd/user/` without enabling anything (you choose what runs).

```sh
systemctl --user daemon-reload
systemctl --user enable --now urfael-daemon              # always-on brain
systemctl --user enable --now urfael-morningbrief.timer  # optional 08:00 brief
```

Logs: `journalctl --user -u urfael-daemon -f`. To keep `--user` units running
after you log out: `loginctl enable-linger "$USER"`.
