#!/bin/bash
set -e
FUNCTIONS=("project_service" "member_service" "task_service" "timelog_service" "seed_data" "user_info")
for func in "${FUNCTIONS[@]}"; do
    echo "Bundling $func..."
    mkdir -p "functions/$func/utils"
    cp functions/utils/*.js "functions/$func/utils/"
    cd "functions/$func" && npm install --production && cd ../..
done
cd client/app && npm install && npm run build && cd ../..
echo "Ready for: catalyst deploy"