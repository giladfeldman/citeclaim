/**
 * DOI reader parity with referencecheck v0.3.0 (citeclaim v0.2.0 review 2, 2026-11-24).
 * Class: "one fact read differently by different readers". Hosts build the abstracts map
 * from referencecheck's output and pass citations from other readers; the two libraries
 * must read a DOI alike. Each row is [input, what referencecheck v0.3.0 reads]: its
 * cleanDoiInput, lower-cased, or null when that is not DOI-shaped. Generated once by
 * running referencecheck v0.3.0 (tag v0.3.0) on these inputs; frozen here. If a row fails,
 * one library changed its reading: change both, then regenerate.
 */
import { normalizeDoi } from '../src/eligibility.js';

const ROWS: Array<[string, string | null]> = [
  ["10.1000/x","10.1000/x"],
  // A broken escape is left as written, as referencecheck v0.3.0 does (checked by running it).
  ["10.1000/%E0%A4%A","10.1000/%e0%a4%a"],
  ["10.1000/X","10.1000/x"],
  ["  10.1000/x  ","10.1000/x"],
  ["doi:10.1000/x","10.1000/x"],
  ["DOI: 10.1000/x","10.1000/x"],
  ["https://doi.org/10.1000/x","10.1000/x"],
  ["http://dx.doi.org/10.1000/x","10.1000/x"],
  ["https://www.doi.org/10.1000/x","10.1000/x"],
  ["doi.org/10.1000/x","10.1000/x"],
  ["https://doi.org/10.1000/x?utm=1","10.1000/x"],
  ["https://doi.org/10.1000/x#sec1","10.1000/x"],
  ["10.1000/x?utm=1","10.1000/x"],
  ["10.1000/x#sec1","10.1000/x#sec1"],
  ["doi:10.1000/x?utm=1","10.1000/x"],
  ["https://doi.org/10.1000/x?","10.1000/x"],
  ["https://doi.org/10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-#","10.1002/(sici)1097-4571(199806)49:8<693::aid-asi4>3.0.co;2-#"],
  ["10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-O","10.1002/(sici)1097-4571(199806)49:8<693::aid-asi4>3.0.co;2-o"],
  ["10.1016/S0140-6736(20)30183-5","10.1016/s0140-6736(20)30183-5"],
  ["10.1016/S0140-6736(20)30183-5)","10.1016/s0140-6736(20)30183-5"],
  ["10.1016/S0140-6736(20)30183-5.","10.1016/s0140-6736(20)30183-5"],
  ["10.1000/x.","10.1000/x"],
  ["10.1000/x,","10.1000/x"],
  ["10.1000/x;","10.1000/x"],
  ["10.1000/x/","10.1000/x"],
  ["10.1000/x//","10.1000/x"],
  ["10.1000/x:","10.1000/x"],
  ["10.1000/x\"","10.1000/x"],
  ["10.1000/x'","10.1000/x"],
  ["10.1000/x]","10.1000/x"],
  ["10.1000/x}","10.1000/x"],
  ["10.1000/[x]","10.1000/[x]"],
  ["10.1000/[x","10.1000/[x"],
  ["(10.1000/x)",null],
  ["10.1000/x)(","10.1000/x)("],
  ["10.1000/a)(b)","10.1000/a)(b"],
  ["10.1000/x%3F","10.1000/x?"],
  ["https://doi.org/10.1000/x%3Fy","10.1000/x?y"],
  ["https://doi.org/10.1000/a%20b","10.1000/a%20b"],
  ["10.1000/a%20b","10.1000/a%20b"],
  ["10.1000/a b",null],
  ["10.1000/x (preprint)","10.1000/x"],
  ["10.1000/x [preprint]","10.1000/x"],
  ["10.1000/x Accessed 2020","10.1000/x"],
  ["10.1/x",null],
  ["10/abc",null],
  ["https://doi.org/10/abc",null],
  ["10.1000",null],
  ["10.1000/",null],
  ["10.231/x","10.231/x"],
  ["10.1234567890/x",null],
  ["https://doi.org/doi:10.1000/x","10.1000/x"],
  ["doi: https://doi.org/10.1000/x","10.1000/x"],
  ["10.1000/x%","10.1000/x%"],
  ["10.1000/%E4%BD%A0","10.1000/你"],
  ["10.1000/x#page-1","10.1000/x#page-1"],
  ["10.1000/x/full","10.1000/x/full"],
  ["10.1000.10/123",null],
  ["",null],
  ["not a doi",null],
  ["https://doi.org/10.1000/x?a=b#c","10.1000/x"],
  ["10.1000/x?a=b","10.1000/x"],
  ["10.1000/pd00??th","10.1000/pd00??th"],
  ["https://doi.org/10.1000/x%23y","10.1000/x#y"],
  ["10.1000/x ","10.1000/x"],
  ["10.1000/x\t","10.1000/x"],
  ["\n10.1000/x\n","10.1000/x"],
  ["https://dx.doi.org/10.1000/x/","10.1000/x"],
  ["HTTPS://DOI.ORG/10.1000/X","10.1000/x"],
  ["https://doi.org/ 10.1000/x","10.1000/x"],
  ["doi:  10.1000/x","10.1000/x"],
  ["10.1000/x.)","10.1000/x"],
  ["10.1000/x).","10.1000/x"],
  ["10.1000/x.,;","10.1000/x"],
];

describe('normalizeDoi reads every input as referencecheck v0.3.0 does', () => {
  it.each(ROWS)('%j -> %j', (input, want) => {
    expect(normalizeDoi(input)).toBe(want);
  });
});
