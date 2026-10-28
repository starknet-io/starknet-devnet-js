import { expect } from "chai";
import { parseJsonPreservingIntegers } from "../src/json";

describe("parseJsonPreservingIntegers", function () {
    it("should reproduce integers exceeding the safe range when stringified", function () {
        const text = '{"amount":123456789123456789123,"negative":-9007199254740993,"list":[1,2]}';
        expect(JSON.stringify(parseJsonPreservingIntegers(text))).to.equal(text);
    });

    it("should parse safe integers, floats and other values regularly", function () {
        const parsed = parseJsonPreservingIntegers('{"a":5,"b":1.5,"c":"0x1","d":null,"e":true}');
        expect(parsed).to.deep.equal({ a: 5, b: 1.5, c: "0x1", d: null, e: true });
    });
});
