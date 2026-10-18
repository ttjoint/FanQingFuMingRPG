import { parseArgs, cleanLine, parseGSP, evalExpr, argVal, argVar, setVar } from "../src/engine/script/gsp.js";
import { assertEq } from "./helpers.mjs";

export function args() {
  assertEq(parseArgs('"你好","世界"').map(a => a.v), ["你好", "世界"]);
  assertEq(parseArgs('a, 12, "x\\ny"'), [{ t: "var", v: "a" }, { t: "num", v: 12 }, { t: "str", v: "x\ny" }]);
}

export function comment() {
  assertEq(cleanLine("Say(1)  // 注释"), "Say(1)");
  assertEq(cleanLine("\r\n  abc  "), "abc");
}

export function parseIf() {
  const nodes = parseGSP('if(a==1)\nSay("x")\nelse\nSay("y")\nendif\n');
  assertEq(nodes.length, 1);
  assertEq(nodes[0].type, "if");
  assertEq(nodes[0].then.length, 1);
  assertEq(nodes[0].else.length, 1);
}

export function evalExprs() {
  assertEq(evalExpr("1+2*3", {}), 7);
  assertEq(evalExpr("(1+2)*3", {}), 9);
  assertEq(evalExpr("10/3", {}), 3);
  assertEq(evalExpr("10%3", {}), 1);
  assertEq(evalExpr("a+1", { a: 4 }), 5);
  assertEq(evalExpr("a<>1", { a: 2 }), 1);
  assertEq(evalExpr("a>=2 && b<5", { a: 2, b: 3 }), 1);
  assertEq(evalExpr("a==1 || b==2", { a: 0, b: 2 }), 1);
}

export function vars() {
  const v = {};
  setVar({ t: "str", v: "flag" }, 1, v);
  assertEq(v.flag, 1);
  assertEq(argVal({ t: "var", v: "flag" }, v), 1);
  assertEq(argVal({ t: "num", v: 9 }, v), 9);
  assertEq(argVar({ t: "var", v: "x" }), "x");
  assertEq(argVar({ t: "num", v: 1 }), null);
}
