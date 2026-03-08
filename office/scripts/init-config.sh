#!/usr/bin/env bash
# Initialize office plugin config
CONFIG_DIR="$HOME/.config/office"
CONFIG_FILE="$CONFIG_DIR/config"

if [[ -f "$CONFIG_FILE" ]]; then
    echo "Config already exists at $CONFIG_FILE"
    exit 0
fi

mkdir -p "$CONFIG_DIR"
cat > "$CONFIG_FILE" << 'EOF'
# office plugin configuration
# Set your Obsidian vault name below (required for office:archive and office:organize)
# OBSIDIAN_VAULT_NAME=MyVault
EOF
echo "Created config at $CONFIG_FILE"
echo "Edit it to set OBSIDIAN_VAULT_NAME before using archive/organize skills."
