import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prepareRoute, assertNoOverflow } from "../test-helpers";

const variant=process.env.PR1823_VARIANT;
const source=variant==="before"?"ec8c940e07582454a475250ade40147e3c89d59f":"77ea643504f5ab5908176669a2056205014bbfe2";
const output=process.env.PR1823_OUTPUT_DIR!;
if(!output || !["before","after"].includes(variant!))throw new Error("Missing pinned capture environment.");

for(const viewport of [
  {name:"desktop",width:1440,height:1100},
  {name:"mobile",width:390,height:844}
]){
  test("actual install formats "+viewport.name,async({page})=>{
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    await prepareRoute(page,"/install","light");
    await expect(page.getByRole("heading",{name:"Linux",exact:true})).toBeVisible();
    const linux=page.locator("div").filter({has:page.getByRole("heading",{name:"Linux",exact:true})}).filter({has:page.getByRole("link",{name:"Download",exact:true})}).last();
    const formats=page.getByRole("group",{name:"Linux package format"});
    const states:unknown[]=[];
    const capture=async(format:string)=>{
      await assertNoOverflow(page);
      await page.screenshot({path:join(output,viewport.name+"-"+format+".png"),fullPage:true,animations:"disabled"});
      states.push({format,viewport:{width:viewport.width,height:viewport.height},title:await page.title(),path:new URL(page.url()).pathname});
    };
    await expect(linux.getByRole("link",{name:"Download",exact:true})).toHaveAttribute("href",/\.AppImage$/);
    if(variant==="before"){
      await expect(formats).toHaveCount(0);
      await capture("appimage");
    }else{
      const linuxCard=page.locator("div").filter({has:page.getByRole("heading",{name:"Linux",exact:true})}).filter({has:formats}).last();
      await expect(formats.getByRole("button",{name:"AppImage",exact:true})).toHaveAttribute("aria-pressed","true");
      await capture("appimage");
      for(const [label,name] of [[".deb","deb"],[".rpm","rpm"]]){
        await formats.getByRole("button",{name:label,exact:true}).click();
        await expect(formats.getByRole("button",{name:label,exact:true})).toHaveAttribute("aria-pressed","true");
        await expect(linuxCard.getByRole("button",{name:"Unavailable in this release",exact:true})).toBeVisible();
        await expect(linuxCard.getByRole("button",{name:"Unavailable in this release",exact:true})).toBeDisabled();
        await expect(linuxCard.getByRole("link",{name:"Download",exact:true})).toHaveCount(0);
        await capture(name);
      }
      await formats.getByRole("button",{name:"AppImage",exact:true}).click();
      await expect(linuxCard.getByRole("link",{name:"Download",exact:true})).toHaveAttribute("href",/\.AppImage$/);
      await capture("appimage-return");
    }
    await mkdir(output,{recursive:true});
    await writeFile(join(output,"observations-"+viewport.name+".json"),JSON.stringify({source,variant,platform:process.platform,releaseFixture:"v0.8.1",states,allInteractionAssertionsPassed:true},null,2)+"\n");
  });
}
