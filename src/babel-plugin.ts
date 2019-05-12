import * as BabelTypes from "@babel/types";
import { Visitor, NodePath } from "@babel/traverse";
import { SourceMapGenerator } from "source-map";
import convert from "convert-source-map";
import stylis from "stylis";

declare const process: any;

interface BabelFile {
    opts: {
        generatorOpts: any;
    };
    code: string;
    path: NodePath;
}

export interface PluginOptions {
    opts?: {
        target?: string;
        runtime?: string;
        stylis?: typeof stylis;
    };
    file: BabelFile;
}

export interface Babel {
    types: typeof BabelTypes;
}

function getGeneratorOpts(
    file: BabelFile,
): { sourceFileName: string; sourceRoot: string } {
    return file.opts.generatorOpts ? file.opts.generatorOpts : file.opts;
}

export function makeSourceMapGenerator(file: BabelFile) {
    const generatorOpts = getGeneratorOpts(file);
    const filename = generatorOpts.sourceFileName;
    const generator = new SourceMapGenerator({
        file: filename,
        sourceRoot: generatorOpts.sourceRoot,
    });

    generator.setSourceContent(filename, file.code);
    return generator;
}

export function getSourceMap(
    offset: {
        line: number;
        column: number;
    },
    file: BabelFile,
): string {
    const generator = makeSourceMapGenerator(file);
    const generatorOpts = getGeneratorOpts(file);
    if (generatorOpts.sourceFileName) {
        generator.addMapping({
            generated: {
                line: 1,
                column: 0,
            },
            source: generatorOpts.sourceFileName,
            original: offset,
        });
        return convert.fromObject(generator).toComment({ multiline: true });
    }
    return "";
}

function createArrayExpression(
    t: typeof BabelTypes,
    strings: string[],
    expressions: BabelTypes.Expression[],
    out: BabelTypes.Expression[],
): BabelTypes.ArrayExpression {
    if (strings.length > 1 && expressions.length >= 1) {
        if (strings[0]) {
            out.push(t.stringLiteral(strings[0]));
        }
        out.push(expressions[0]);
        return createArrayExpression(
            t,
            strings.slice(1),
            expressions.slice(1),
            out,
        );
    }

    if (strings.length === 1) {
        if (strings[0]) {
            out.push(t.stringLiteral(strings[0]));
        }
    }

    return t.arrayExpression(out);
}

export default function bemedBabelPlugin(
    babel: Babel,
): { visitor: Visitor<PluginOptions> } {
    const t = babel.types;

    /**
     * Local name of the css import from react-bemed/css if any
     */
    let name: string | null = null;

    return {
        visitor: {
            Program() {
                // Reset import name state when entering a new file
                name = null;
            },

            ImportDeclaration(path, state) {
                const opts = state.opts || {};

                const target = opts.target || "react-bemed/css";

                if (path.node.source.value !== target) {
                    return;
                }

                for (const s of path.node.specifiers) {
                    if (!t.isImportSpecifier(s)) {
                        continue;
                    }
                    if (s.imported.name === "css") {
                        name = s.local.name;
                    }
                }
            },

            TaggedTemplateExpression(path, state) {
                if (!name) {
                    return;
                }

                if (!t.isIdentifier(path.node.tag, { name })) {
                    return;
                }

                if (!path.node.loc) {
                    return;
                }

                const sourceMap =
                    process.env.NODE_ENV === "production"
                        ? ""
                        : getSourceMap(path.node.loc.start, state.file);

                const styleString = path.node.quasi.quasis
                    .map(q => {
                        return q.value.raw;
                    })
                    .join("__BEMED_VAR__");

                const finalStylis = (state.opts && state.opts.stylis) || stylis;

                const compiled: string[] = finalStylis(
                    "__BEMED__",
                    styleString,
                ).split("__BEMED_VAR__");

                const arrayJoin = t.callExpression(
                    t.memberExpression(
                        createArrayExpression(
                            t,
                            compiled,
                            path.node.quasi.expressions,
                            [],
                        ),
                        t.identifier("join"),
                    ),
                    [t.stringLiteral("")],
                );

                const sourceMapStringLiteral = t.stringLiteral(sourceMap);

                path.replaceWith(
                    t.callExpression(t.identifier(name), [
                        arrayJoin,
                        t.booleanLiteral(true),
                        sourceMapStringLiteral,
                    ]),
                );
            },
        },
    };
}
