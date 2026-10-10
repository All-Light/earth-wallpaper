#!/usr/bin/env bash
set -euo pipefail
systemctl --user disable --now earth-now-wallpaper.socket earth-now-wallpaper.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/earth-now-wallpaper.service" "$HOME/.config/systemd/user/earth-now-wallpaper.socket"
systemctl --user daemon-reload
kpackagetool6 --type Plasma/Wallpaper --remove org.kde.plasma.earth
