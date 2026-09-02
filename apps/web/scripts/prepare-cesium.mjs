import {cpSync,existsSync,mkdirSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../../');
const source=resolve(root,'node_modules/cesium/Build/Cesium');
const target=resolve(import.meta.dirname,'../public/cesium');
if(!existsSync(source)) throw new Error('Cesium is not installed; run npm install from the repository root.');
rmSync(target,{recursive:true,force:true}); mkdirSync(target,{recursive:true});
for(const name of ['Assets','ThirdParty','Widgets','Workers']) cpSync(resolve(source,name),resolve(target,name),{recursive:true});
console.log('Prepared Cesium runtime assets.');
