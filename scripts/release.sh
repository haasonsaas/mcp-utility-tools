#!/bin/bash

# Release script for MCP Utility Tools

set -e

echo "🚀 Preparing release for MCP Utility Tools..."

# Check if on main branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "❌ You must be on the main branch to release. Current branch: $BRANCH"
  exit 1
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
  echo "❌ You have uncommitted changes. Please commit or stash them first."
  exit 1
fi

# Run tests
echo "🧪 Running tests..."
npm test

# Build
echo "🔨 Building project..."
npm run build

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "📦 Current version: $CURRENT_VERSION"

# Prompt for new version
echo "Enter new version (or press enter to keep current):"
read NEW_VERSION

if [ -z "$NEW_VERSION" ]; then
  NEW_VERSION=$CURRENT_VERSION
fi

# Update version
npm version $NEW_VERSION --no-git-tag-version

# Update CHANGELOG
echo "📝 Don't forget to update CHANGELOG.md with release notes!"
echo "Press enter when ready to continue..."
read

# Git operations
git add -A
git commit -m "chore: release v$NEW_VERSION"
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"

echo "✅ Release prepared!"
echo ""
echo "Next steps:"
echo "1. Push to GitHub: git push origin main --tags"
echo "2. Create GitHub release from tag v$NEW_VERSION"
echo "3. Publish to npm: npm publish"
echo ""
echo "To publish to npm:"
echo "  npm login (if needed)"
echo "  npm publish"