#!/bin/bash

# Find all .ts files in src and add .js to local imports that don't have extensions

find src -name "*.ts" -exec perl -i -pe 's/from "(\.\.?\/[^"]*)"/from "$1.js"/g if $1 !~ /\.js$/' {} \;

echo "Added .js extensions to local imports."