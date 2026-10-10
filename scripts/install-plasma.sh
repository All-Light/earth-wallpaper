#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v kpackagetool6 >/dev/null || { echo "KDE Plasma 6 kpackagetool6 is required." >&2; exit 1; }
package_dir="$project_dir/plasma/org.kde.plasma.earth"
[[ -f "$package_dir/contents/shaders/earth.frag.qsb" && -f "$package_dir/contents/code/EarthMath.js" ]] || {
  echo "Native assets are missing. Run npm run build:native first." >&2; exit 1;
}
if kpackagetool6 --type Plasma/Wallpaper --list | grep -Fq 'org.kde.plasma.earth'; then
  kpackagetool6 --type Plasma/Wallpaper --upgrade "$package_dir"
else
  kpackagetool6 --type Plasma/Wallpaper --install "$package_dir"
fi
# Retire the earlier browser server if this user installed it. No new service is needed.
if command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
  systemctl --user disable --now earth-now-wallpaper.socket earth-now-wallpaper.service 2>/dev/null || true
fi
printf '\nNative wallpaper installed. Choose Earth wallpaper in Plasma Desktop Settings.\n'
printf 'No browser, Node process or server is needed at runtime.\n'
