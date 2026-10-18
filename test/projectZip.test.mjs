import { packToZip, zipToPack } from "../src/content/projectZip.js";
import { assert, assertEq } from "./helpers.mjs";

export function roundtrip() {
  const pack = {
    format: "gsxy.pack", version: 2, name: "测试项目", base: "__default__",
    patch: { content: { npcs: { "1": { id: 1, name: "x" } } }, maps: { 孙家庄: { width: 2 } } },
    images: { "assets/x.png": "data:image/png;base64,AAAA", "assets/ui/y.png": "data:image/png;base64,AQID" },
  };
  const bytes = packToZip(pack);
  assert(bytes instanceof Uint8Array && bytes.length > 0, "应产出 zip 字节");
  const back = zipToPack(bytes);
  assertEq(back.patch, pack.patch);
  assertEq(back.name, pack.name);
  assertEq(back.images["assets/x.png"], "data:image/png;base64,AAAA");
  assertEq(back.images["assets/ui/y.png"], "data:image/png;base64,AQID");
}
