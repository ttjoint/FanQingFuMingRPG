import { makeRef, parseRef, refKind, refId, itemRef, npcRef } from "../src/content/ids.js";
import { assert, assertEq } from "./helpers.mjs";

export function refRoundTrip() {
  assertEq(parseRef(makeRef("item", "金创药")), { kind: "item", id: "金创药" });
  assertEq(refKind(itemRef("x")), "item");
  assertEq(refId(npcRef(15)), "15");
  assertEq(parseRef("noColon"), { kind: "", id: "noColon" });
}
