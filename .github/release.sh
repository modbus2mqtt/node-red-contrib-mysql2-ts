#!/bin/bash
set -e

# Release script for node-red-contrib-mysql2-ts

# Ensure on master branch
git checkout master

# Pull latest changes
git pull

# Install dependencies and run tests 
npm install
npm run build
npm test
if [ "$#" == 1 ]
then
  npm version  "$1"
else
  npm version patch
fi
git push
git pull
version="$(node -p "require('./package.json').version")" 
echo git push
git push
echo git tag
git tag -a "$version" -m "Release $version")"   
# Push changes and tags
echo git push tag
git push --tags

echo "Release complete!"
