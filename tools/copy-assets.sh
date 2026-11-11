#!/usr/bin/env bash
# Copy the subset of upstream Oolite assets the browser port actually uses.
# Textures are downscaled to 1024px so web/ stays well under 60 MB.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RES="$ROOT/upstream/Resources"
OUT="$ROOT/web/assets"

mkdir -p "$OUT"/{models,textures,config,sounds}

# --- models -----------------------------------------------------------------
MODELS=(
  oolite_cobra3
  oolite_mamba
  oolite_krait
  oolite_python
  oolite_cobramk1
  oolite_asp
  oolite_anaconda
  oolite_boa
  oolite_boa-mk2
  oolite_gecko
  oolite_viper
  oolite_coriolis
  oolite_coriolis_dock
  oolite_coriolis_faceplate
  oolite_coriolis_tris
)
for m in "${MODELS[@]}"; do
  cp "$RES/Models/$m.dat" "$OUT/models/$m.dat"
done

# --- textures (downscale to max 1024px) -------------------------------------
# Only diffuse maps: the port's resolveTextureName() reads diffuse_map only,
# so _normal / _specular maps are never fetched and never copied.
TEXTURES=(
  oolite_cobra3_diffuse.png
  oolite_cobra3_subents.png
  oolite_mamba_diffuse.png
  oolite_mamba_subents.png
  oolite_krait_diffuse.png
  oolite_python_diffuse.png
  oolite_python_subents.png
  oolite_cobramk1_diffuse.png
  oolite_asp_diffuse.png
  oolite_asp_subents.png
  oolite_anaconda_diffuse.png
  oolite_anaconda_subents.png
  oolite_boa_diffuse.png
  oolite_boa_subents.png
  oolite_boa-mk2_diffuse.png
  oolite_boa-mk2_subents.png
  oolite_gecko_diffuse.png
  oolite_gecko_subents.png
  oolite_viper_diffuse.png
  oolite_coriolis_diffuse.png
  oolite_coriolis_dock_diffuse.png
  oolite_coriolis_faceplate_diffuse.png
  oolite_coriolis_tris_diffuse.png
)
for t in "${TEXTURES[@]}"; do
  if [ ! -f "$OUT/textures/$t" ] || [ "$RES/Textures/$t" -nt "$OUT/textures/$t" ]; then
    convert "$RES/Textures/$t" -resize '1024x1024>' -strip "$OUT/textures/$t"
    echo "texture: $t"
  fi
done

# --- config -----------------------------------------------------------------
CONFIG=(hud.plist crosshairs.plist shipdata.plist planetinfo.plist equipment.plist shipyard.plist)
for c in "${CONFIG[@]}"; do
  cp "$RES/Config/$c" "$OUT/config/$c"
done

# --- sounds -----------------------------------------------------------------
SOUNDS=(laser.ogg laserhits.ogg hit.ogg hullbang.ogg bigbang.ogg beep.ogg boop.ogg
        guiclick.ogg afterburner1.ogg warning.ogg missile.ogg buy.ogg sell.ogg)
for s in "${SOUNDS[@]}"; do
  cp "$RES/Sounds/$s" "$OUT/sounds/$s"
done

echo "web/assets size: $(du -sh "$OUT" | cut -f1)"
