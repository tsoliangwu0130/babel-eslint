var assert = require("assert");
var babelEslint = require("..");
var espree = require("espree");
var escope = require("eslint-scope");
var util = require("util");
var unpad = require("dedent");

// Checks if the source ast implements the target ast. Ignores extra keys on source ast
function assertImplementsAST(target, source, path) {
  if (!path) {
    path = [];
  }

  function error(text) {
    var err = new Error(`At ${path.join(".")}: ${text}:`);
    err.depth = path.length + 1;
    throw err;
  }

  var typeA = target === null ? "null" : typeof target;
  var typeB = source === null ? "null" : typeof source;
  if (typeA !== typeB) {
    error(
      `have different types (${typeA} !== ${typeB}) (${target} !== ${source})`
    );
  } else if (
    typeA === "object" &&
    ["RegExp"].indexOf(target.constructor.name) !== -1 &&
    target.constructor.name !== source.constructor.name
  ) {
    error(
      `object have different constructors (${target.constructor
        .name} !== ${source.constructor.name}`
    );
  } else if (typeA === "object") {
    var keysTarget = Object.keys(target);
    for (var i in keysTarget) {
      var key = keysTarget[i];
      path.push(key);
      assertImplementsAST(target[key], source[key], path);
      path.pop();
    }
  } else if (target !== source) {
    error(
      `are different (${JSON.stringify(target)} !== ${JSON.stringify(source)})`
    );
  }
}

function lookup(obj, keypath, backwardsDepth) {
  if (!keypath) {
    return obj;
  }

  return keypath
    .split(".")
    .slice(0, -1 * backwardsDepth)
    .reduce((base, segment) => {
      return base && base[segment], obj;
    });
}

function parseAndAssertSame(code) {
  var esAST = espree.parse(code, {
    ecmaFeatures: {
      // enable JSX parsing
      jsx: true,
      // enable return in global scope
      globalReturn: true,
      // enable implied strict mode (if ecmaVersion >= 5)
      impliedStrict: true,
      // allow experimental object rest/spread
      experimentalObjectRestSpread: true,
    },
    tokens: true,
    loc: true,
    range: true,
    comment: true,
    attachComment: true,
    ecmaVersion: 8,
    sourceType: "module",
  });
  var babylonAST = babelEslint.parse(code);
  try {
    assertImplementsAST(esAST, babylonAST);
  } catch (err) {
    var traversal = err.message.slice(3, err.message.indexOf(":"));
    if (esAST.tokens) {
      delete esAST.tokens;
    }
    if (babylonAST.tokens) {
      delete babylonAST.tokens;
    }
    err.message += unpad(`
      espree:
      ${util.inspect(lookup(esAST, traversal, 2), {
        depth: err.depth,
        colors: true,
      })}
      babel-eslint:
      ${util.inspect(lookup(babylonAST, traversal, 2), {
        depth: err.depth,
        colors: true,
      })}
    `);
    throw err;
  }
  // assert.equal(esAST, babylonAST);
}

describe("babylon-to-esprima", () => {
  describe("compatibility", () => {
    it("should allow ast.analyze to be called without options", function() {
      var esAST = babelEslint.parse("`test`");

      assert.doesNotThrow(
        () => {
          escope.analyze(esAST);
        },
        TypeError,
        "Should allow no options argument."
      );
    });
  });

  describe("templates", () => {
    it("empty template string", () => {
      parseAndAssertSame("``");
    });

    it("template string", () => {
      parseAndAssertSame("`test`");
    });

    it("template string using $", () => {
      parseAndAssertSame("`$`");
    });

    it("template string with expression", () => {
      parseAndAssertSame("`${a}`");
    });

    it("template string with multiple expressions", () => {
      parseAndAssertSame("`${a}${b}${c}`");
    });

    it("template string with expression and strings", () => {
      parseAndAssertSame("`a${a}a`");
    });

    it("template string with binary expression", () => {
      parseAndAssertSame("`a${a + b}a`");
    });

    it("tagged template", () => {
      parseAndAssertSame("jsx`<Button>Click</Button>`");
    });

    it("tagged template with expression", () => {
      parseAndAssertSame("jsx`<Button>Hi ${name}</Button>`");
    });

    it("tagged template with new operator", () => {
      parseAndAssertSame("new raw`42`");
    });

    it("template with nested function/object", () => {
      parseAndAssertSame(
        "`outer${{x: {y: 10}}}bar${`nested${function(){return 1;}}endnest`}end`"
      );
    });

    it("template with braces inside and outside of template string #96", () => {
      parseAndAssertSame(
        "if (a) { var target = `{}a:${webpackPort}{}}}}`; } else { app.use(); }"
      );
    });

    it("template also with braces #96", () => {
      parseAndAssertSame(
        unpad(`
          export default function f1() {
            function f2(foo) {
              const bar = 3;
              return \`\${foo} \${bar}\`;
            }
            return f2;
          }
        `)
      );
    });

    it("template with destructuring #31", () => {
      parseAndAssertSame(
        unpad(`
          module.exports = {
            render() {
              var {name} = this.props;
              return Math.max(null, \`Name: \${name}, Name: \${name}\`);
            }
          };
        `)
      );
    });
  });

  it("simple expression", () => {
    parseAndAssertSame("a = 1");
  });

  it("class declaration", () => {
    parseAndAssertSame("class Foo {}");
  });

  it("class expression", () => {
    parseAndAssertSame("var a = class Foo {}");
  });

  it("jsx expression", () => {
    parseAndAssertSame("<App />");
  });

  it("jsx expression with 'this' as identifier", () => {
    parseAndAssertSame("<this />");
  });

  it("jsx expression with a dynamic attribute", () => {
    parseAndAssertSame("<App foo={bar} />");
  });

  it("jsx expression with a member expression as identifier", () => {
    parseAndAssertSame("<foo.bar />");
  });

  it("jsx expression with spread", () => {
    parseAndAssertSame("var myDivElement = <div {...this.props} />;");
  });

  it("empty jsx text", () => {
    parseAndAssertSame("<a></a>");
  });

  it("jsx text with content", () => {
    parseAndAssertSame("<a>Hello, world!</a>");
  });

  it("nested jsx", () => {
    parseAndAssertSame("<div>\n<h1>Wat</h1>\n</div>");
  });

  it("default import", () => {
    parseAndAssertSame('import foo from "foo";');
  });

  it("import specifier", () => {
    parseAndAssertSame('import { foo } from "foo";');
  });

  it("import specifier with name", () => {
    parseAndAssertSame('import { foo as bar } from "foo";');
  });

  it("import bare", () => {
    parseAndAssertSame('import "foo";');
  });

  it("export default class declaration", () => {
    parseAndAssertSame("export default class Foo {}");
  });

  it("export default class expression", () => {
    parseAndAssertSame("export default class {}");
  });

  it("export default function declaration", () => {
    parseAndAssertSame("export default function Foo() {}");
  });

  it("export default function expression", () => {
    parseAndAssertSame("export default function () {}");
  });

  it("export all", () => {
    parseAndAssertSame('export * from "foo";');
  });

  it("export named", () => {
    parseAndAssertSame("export { foo };");
  });

  it("export named alias", () => {
    parseAndAssertSame("export { foo as bar };");
  });

  it.skip("empty program with line comment", () => {
    parseAndAssertSame("// single comment");
  });

  it.skip("empty program with block comment", () => {
    parseAndAssertSame("  /* multiline\n * comment\n*/");
  });

  it("line comments", () => {
    parseAndAssertSame(
      unpad(`
        // single comment
        var foo = 15; // comment next to statement
        // second comment after statement
      `)
    );
  });

  it("block comments", () => {
    parseAndAssertSame(
      unpad(`
        /* single comment */
        var foo = 15; /* comment next to statement */
        /*
         * multiline
         * comment
         */
       `)
    );
  });

  it("block comments #124", () => {
    parseAndAssertSame(
      unpad(`
        React.createClass({
          render() {
            // return (
            //   <div />
            // ); // <-- this is the line that is reported
          }
        });
      `)
    );
  });

  it("null", () => {
    parseAndAssertSame("null");
  });

  it("boolean", () => {
    parseAndAssertSame("if (true) {} else if (false) {}");
  });

  it("regexp", () => {
    parseAndAssertSame("/affix-top|affix-bottom|affix|[a-z]/");
  });

  it("regexp", () => {
    parseAndAssertSame("const foo = /foo/;");
  });

  it("regexp y flag", () => {
    parseAndAssertSame("const foo = /foo/y;");
  });

  it("regexp u flag", () => {
    parseAndAssertSame("const foo = /foo/u;");
  });

  it("regexp in a template string", () => {
    parseAndAssertSame('`${/\\d/.exec("1")[0]}`');
  });

  it("first line is empty", () => {
    parseAndAssertSame('\nimport Immutable from "immutable";');
  });

  it("empty", () => {
    parseAndAssertSame("");
  });

  it("jsdoc", () => {
    parseAndAssertSame(
      unpad(`
        /**
        * @param {object} options
        * @return {number}
        */
        const test = function({ a, b, c }) {
          return a + b + c;
        };
        module.exports = test;
      `)
    );
  });

  it("empty block with comment", () => {
    parseAndAssertSame(
      unpad(`
        function a () {
          try {
            b();
          } catch (e) {
            // asdf
          }
        }
      `)
    );
  });

  describe("babel tests", () => {
    it("MethodDefinition", () => {
      parseAndAssertSame(
        unpad(`
          export default class A {
            a() {}
          }
        `)
      );
    });

    it("MethodDefinition 2", () => {
      parseAndAssertSame(
        "export default class Bar { get bar() { return 42; }}"
      );
    });

    it("ClassMethod", () => {
      parseAndAssertSame(
        unpad(`
          class A {
            constructor() {
            }
          }
        `)
      );
    });

    it("ClassMethod multiple params", () => {
      parseAndAssertSame(
        unpad(`
          class A {
            constructor(a, b, c) {
            }
          }
        `)
      );
    });

    it("ClassMethod multiline", () => {
      parseAndAssertSame(
        unpad(`
          class A {
            constructor (
              a,
              b,
              c
            )

            {

            }
          }
        `)
      );
    });

    it("ClassMethod oneline", () => {
      parseAndAssertSame("class A { constructor(a, b, c) {} }");
    });

    it("ObjectMethod", () => {
      parseAndAssertSame(
        unpad(`
          var a = {
            b(c) {
            }
          }
        `)
      );
    });

    it("do not allow import export everywhere", () => {
      assert.throws(() => {
        parseAndAssertSame('function F() { import a from "a"; }');
      }, /SyntaxError: 'import' and 'export' may only appear at the top level/);
    });

    it("return outside function", () => {
      parseAndAssertSame("return;");
    });

    it("super outside method", () => {
      parseAndAssertSame("function F() { super(); }");
    });

    it("StringLiteral", () => {
      parseAndAssertSame("");
      parseAndAssertSame("");
      parseAndAssertSame("a");
    });

    it("getters and setters", () => {
      parseAndAssertSame("class A { get x ( ) { ; } }");
      parseAndAssertSame(
        unpad(`
          class A {
            get x(
            )
            {
              ;
            }
          }
        `)
      );
      parseAndAssertSame("class A { set x (a) { ; } }");
      parseAndAssertSame(
        unpad(`
          class A {
            set x(a
            )
            {
              ;
            }
          }
        `)
      );
      parseAndAssertSame(
        unpad(`
          var B = {
            get x () {
              return this.ecks;
            },
            set x (ecks) {
              this.ecks = ecks;
            }
          };
        `)
      );
    });

    it("RestOperator", () => {
      parseAndAssertSame("var { a, ...b } = c");
      parseAndAssertSame("var [ a, ...b ] = c");
      parseAndAssertSame("var a = function (...b) {}");
    });

    it("SpreadOperator", () => {
      parseAndAssertSame("var a = { b, ...c }");
      parseAndAssertSame("var a = [ a, ...b ]");
      parseAndAssertSame("var a = sum(...b)");
    });

    it("Async/Await", () => {
      parseAndAssertSame(
        unpad(`
          async function a() {
            await 1;
          }
        `)
      );
    });
  });
});
