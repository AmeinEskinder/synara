import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.GITHUB_WORKSPACE || process.cwd();
const driver = dirname(fileURLToPath(import.meta.url));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args, {cwd:root,encoding:"utf8"}).trim();
const pins = {
  before: { source:"ec8c940e07582454a475250ade40147e3c89d59f", tree:"26c3b060469f224dce8135d8046697eb43fe0794" },
  after: { source:"77ea643504f5ab5908176669a2056205014bbfe2", tree:"1f6494d1746b5bf66a62872a5d25460795a82faa" }
};
const variant = process.env.PR1823_VARIANT;
const pin = pins[variant];
if (!pin || !["linux","darwin"].includes(process.platform)) throw new Error("Unknown variant or native host.");
const out = resolve(root,".pr1823-marketing-output",process.platform+"-"+variant);
const manifestPath=join(out,"provenance.json");
const site=join(root,"apps/marketing");
const golden="apps/marketing/tests/visual/visual.spec.ts-snapshots/install-desktop-light-"+process.platform+".png";
const command=process.argv[2];
const assertSource=() => {
  if(git("rev-parse","HEAD")!==pin.source || git("rev-parse","HEAD^{tree}")!==pin.tree) throw new Error("Wrong immutable application source.");
};
const walk=(dir) => readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
if(command==="prepare"){
  assertSource();
  if(git("diff","HEAD","--name-only"))throw new Error("Application source starts dirty.");
  mkdirSync(out,{recursive:true});
  const snapshot=JSON.parse(readFileSync(join(site,"src/data/latest-release-downloads.json"),"utf8"));
  if(snapshot.version!=="v0.8.1")throw new Error("Unknown deterministic release fixture.");
  if(variant==="after" && (snapshot.linux.deb!==null || snapshot.linux.rpm!==null))throw new Error("Expected explicitly absent package assets.");
  const copied=[
    ["capture.spec.ts","tests/e2e/pr1823-capture.spec.ts"],
    ["capture.config.ts","playwright.pr1823.config.ts"]
  ];
  for(const [from,to] of copied){
    const target=join(site,to);
    if(existsSync(target))throw new Error("Capture path already exists: "+to);
    copyFileSync(join(driver,from),target);
  }
  const manifest={
    source:pin.source, sourceTree:pin.tree, variant, platform:process.platform, arch:process.arch,
    driver:execFileSync("git",["rev-parse","HEAD"],{cwd:driver,encoding:"utf8"}).trim(),
    fixture:snapshot, sourceFiles:[],
    captureFiles:copied.map(([from,to])=>({path:to,sha256:digest(readFileSync(join(driver,from)))})),
    qualification:"Actual production Next /install and Chromium, deterministic checked-in v0.8.1 release data. Theme/motion/font/image preparation is the unchanged production test helper. Does not prove a public Deb/RPM release, installation, or native app behavior.",
    status:"prepared"
  };
  for(const path of ["src/components/InstallOptions.tsx","src/lib/releases.ts","src/data/latest-release-downloads.json","tests/test-helpers.ts","tests/visual/visual.spec.ts","playwright.config.ts"]){
    manifest.sourceFiles.push({path,blob:git("rev-parse","HEAD:apps/marketing/"+path),sha256:digest(readFileSync(join(site,path)))});
  }
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+"\n");
  if(!process.env.GITHUB_ENV)throw new Error("Missing GITHUB_ENV.");
  appendFileSync(process.env.GITHUB_ENV,"PR1823_OUTPUT_DIR="+out+"\n");
  console.log(JSON.stringify(manifest));
}else if(command==="run"){
  assertSource();
  const label=process.argv[3];
  if(!["build","original-snapshot","capture","generate-golden"].includes(label) || process.argv[4]!=="--")throw new Error("Invalid command.");
  if(label==="generate-golden"&&variant!=="after")throw new Error("Only the changed source may generate a candidate baseline.");
  const args=process.argv.slice(5);
  if(!args.length)throw new Error("Missing process.");
  const chunks=[];
  const child=spawn(args[0],args.slice(1),{cwd:process.cwd(),env:process.env,shell:false,stdio:["ignore","pipe","pipe"]});
  for(const stream of [child.stdout,child.stderr])stream.on("data",chunk=>{chunks.push(chunk);process.stdout.write(chunk);});
  const result=await new Promise(resolveResult=>{
    child.once("error",error=>resolveResult({exitCode:127,error:String(error)}));
    child.once("close",(code,signal)=>resolveResult({exitCode:code??1,signal}));
  });
  writeFileSync(join(out,label+".log"),Buffer.concat(chunks));
  writeFileSync(join(out,label+"-result.json"),JSON.stringify({...result,command:args,cwd:relative(root,process.cwd())},null,2)+"\n");
  process.exitCode=result.exitCode;
}else if(command==="verify"){
  assertSource();
  const manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
  const changed=git("diff","HEAD","--name-only").split("\n").filter(Boolean);
  if(changed.some(path=>variant!=="after"||path!==golden))throw new Error("Unapproved tracked source mutation: "+changed.join(","));
  for(const item of manifest.sourceFiles){
    if(digest(readFileSync(join(site,item.path)))!==item.sha256)throw new Error("Production/helper/assertion source changed: "+item.path);
  }
  for(const item of manifest.captureFiles){
    if(digest(readFileSync(join(site,item.path)))!==item.sha256)throw new Error("Capture driver changed.");
  }
  const results={};
  for(const name of ["build","original-snapshot","capture",...(variant==="after"?["generate-golden"]:[])]){
    results[name]=JSON.parse(readFileSync(join(out,name+"-result.json"),"utf8"));
  }
  const observations=["desktop","mobile"].map(layout=>JSON.parse(readFileSync(join(out,"observations-"+layout+".json"),"utf8")));
  if(observations.some(o=>o.source!==pin.source || o.variant!==variant || o.platform!==process.platform))throw new Error("Observation source mismatch.");
  if(variant==="after"){
    const bytes=readFileSync(join(root,golden));
    if(bytes.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw new Error("Candidate golden is not PNG.");
    mkdirSync(join(out,"candidate-golden"),{recursive:true});
    copyFileSync(join(root,golden),join(out,"candidate-golden",golden.split("/").at(-1)));
  }
  const files=walk(out).filter(path=>path!==manifestPath).map(path=>{
    const bytes=readFileSync(path);
    return {path:relative(out,path),bytes:bytes.length,sha256:digest(bytes)};
  });
  const positiveComplete=results.build.exitCode===0&&results.capture.exitCode===0&&(variant!=="after"||results["generate-golden"].exitCode===0);
  const final={
    ...manifest,status:positiveComplete?"capture-completed":"capture-failed",results,observations,files,
    changedTrackedFiles:changed,
    originalSnapshotPassed:results["original-snapshot"].exitCode===0,
    qualification:manifest.qualification+" The original unchanged snapshot check retains its raw exit and remains a failing workflow step if it fails. --update-snapshots only produces a candidate for independent visual review; it is not an original-baseline pass."
  };
  writeFileSync(manifestPath,JSON.stringify(final,null,2)+"\n");
  console.log(JSON.stringify({source:pin.source,status:final.status,results,files:files.length,originalSnapshotPassed:final.originalSnapshotPassed}));
  if(!positiveComplete)process.exitCode=1;
}else throw new Error("Use prepare, run, or verify.");
