#!/bin/bash
# Game On Dude! - Pre-build hook
# Installs dependencies before build

cd /var/app/staging

# Install all dependencies (including devDependencies for TypeScript)
npm ci

echo "Dependencies installed successfully"
