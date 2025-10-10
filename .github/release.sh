#!/bin/bash
set -e

# Release script for node-red-contrib-mysql2-ts

# Ensure on main branch
git checkout main

# Pull latest changes
git pull

# Install dependencies and run tests
npm install
npm run build
npm test

# Bump version (patch by default, change if needed)
npm version patch
git tag -a "v$(node -p "require('./package.json').version")" -m "Release v$(node -p "require('./package.json').version")"   
# Push changes and tags
git push
git push --tags

echo "Release complete!"