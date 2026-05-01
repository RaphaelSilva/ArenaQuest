#!/bin/bash

# Exit on error
set -e

# Default environment
ENV="prd"
SECRET_NAME=""

# Check if at least one argument is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <SECRET_NAME> [--env <environment>]"
    echo "Example: $0 JWT_SECRET --env staging"
    exit 1
fi

SECRET_NAME=$1
shift

# Parse remaining arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --env)
            if [ -n "$2" ]; then
                ENV="$2"
                shift 2
            else
                echo "Error: --env requires an argument."
                exit 1
            fi
            ;;
        *)
            echo "Error: Unknown option $1"
            exit 1
            ;;
    esac
done

echo "----------------------------------------------------"
echo "Creating secret: $SECRET_NAME"
echo "Environment:     $ENV"
echo "----------------------------------------------------"

# We use read -s to securely ask for the secret value
read -sp "Enter the value for $SECRET_NAME: " SECRET_VALUE
echo -e "\n"

if [ -z "$SECRET_VALUE" ]; then
    echo "Error: Secret value cannot be empty."
    exit 1
fi

# Navigate to the apps/api directory where wrangler.jsonc is located
# Adjust the path if necessary depending on where the script is called from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT/apps/api"

# Pass the secret to wrangler
# Using echo to pipe the value directly
echo "$SECRET_VALUE" | npx wrangler secret put "$SECRET_NAME" --env "$ENV"

echo "----------------------------------------------------"
echo "Secret $SECRET_NAME successfully updated in $ENV!"
echo "----------------------------------------------------"
