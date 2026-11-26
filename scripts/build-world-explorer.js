'use strict';
require('esbuild').buildSync({entryPoints:['client/explorer/app.js'],bundle:true,minify:true,format:'iife',target:'es2020',loader:{'.html':'text'},outfile:'public/world-explorer.js'});
