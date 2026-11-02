#!/bin/bash
echo "Setting up environment for aiostreams-trakt-tracker"

# Install dependencies
npm install --save-dev typescript @types/node zod tsx

# Install @aiostreams/addon-sdk from local file
npm install --save-dev @aiostreams/addon-sdk@file:./addon-sdk.tgz

# Ensure TypeScript compiler is available
if ! command -v tsc &> /dev/null; then
  echo "Installing TypeScript globally"
  npm install -g typescript
fi

# Verify tsx is available
if ! command -v tsx &> /dev/null; then
  echo "Installing tsx globally"
  npm install -g tsx
fi

# Verify tsconfig.json is valid
if ! npx tsc --noEmit --project tsconfig.json; then
  echo "TypeScript compilation failed. Fix tsconfig.json first."
  exit 1
fi

echo "Environment setup complete"
