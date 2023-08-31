import { Argv } from 'yargs';
import { genTypescripts } from './gents';
import fs from 'fs';
import ts from 'typescript';
import path from 'path';

export default async (yargs: Argv) => {
  const { argv } = yargs
    .usage('usage: $0 genjs <paths...> [options]')
    .positional('paths', {
      describe: 'a list of contract folders',
      type: 'string'
    })
    .option('--react-query', {
      type: 'boolean',
      description: 'Build with react-query support',
      default: false
    })
    .option('output', {
      alias: 'o',
      type: 'string',
      description: 'The output folder',
      default: undefined
    });

  const start = Date.now();
  // @ts-ignore
  const { outPath } = await genTypescripts(argv._.slice(1), argv.reactQuery, argv.output);
  const files = fs.readdirSync(outPath).map((filename) => path.join(outPath, filename));
  const program = ts.createProgram([path.join(outPath, 'index.ts')], {
    skipLibCheck: true,
    declaration: true,
    sourceMap: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    lib: ['ES2020', 'dom'],
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    typeRoots: ['node_modules/@types'],

    allowJs: true,
    esModuleInterop: true,
    baseUrl: '.',
    outDir: outPath,
    rootDir: outPath
  });
  program.emit();
  files.map(fs.promises.unlink);

  console.log('✨ all done in', Date.now() - start, 'ms!');
};
