/**
 * @lash/infra-scripts — workspace tooling: codegen, schema snapshots, AI prompt scaffolds.
 * Status: SCAFFOLD — implement utilities as lanes need them.
 */

export interface CodegenTarget {
  name: 'schema-snapshot' | 'ai-prompt-pack' | 'fixture-doc-shas';
  outputPath: string;
}

export const runCodegen = async (_target: CodegenTarget): Promise<void> => {
  throw new Error('runCodegen: not implemented (open per lane needs)');
};
