/** Node-only, verified-cache preparation for filesystem-based pack fixtures and checks. */
export interface PackInputs {
  targets: string[];
  materialize(repoPath: string, text: string): string;
}

export function packInputs(root: string): PackInputs;
