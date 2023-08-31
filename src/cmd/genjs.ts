import { Argv } from 'yargs';
import { genTypescripts } from './gents';
import fs from 'fs';
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
  process.argv = process.argv.slice(0, 2);
  process.argv.push(...[path.join(outPath, 'index.ts'), '--declaration', '--skipLibCheck', '--sourceMap', '--rootDir', outPath, '--outDir', outPath, '--module', 'commonjs', '--moduleResolution', 'node']);
  require('typescript/lib/tsc.js');
  files.forEach(fs.promises.unlink);
  console.log('✨ all done in', Date.now() - start, 'ms!');
};
