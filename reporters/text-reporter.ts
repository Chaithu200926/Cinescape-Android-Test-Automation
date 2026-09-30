import fs from 'node:fs';
import path from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

type TextReporterOptions = {
  outputFile?: string;
};

class TextReporter implements Reporter {
  private readonly outputFile: string;
  private readonly lines: string[] = [];

  constructor(options: TextReporterOptions = {}) {
    this.outputFile = path.resolve(
      process.cwd(),
      options.outputFile ?? 'test-results/test-execution.log.txt',
    );
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.lines.push(`Test run started: ${new Date().toISOString()}`);
    this.lines.push(`Tests discovered: ${suite.allTests().length}`);
    this.lines.push(`Workers: ${config.workers}`);
    this.lines.push('');
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.lines.push(
      `[${result.status.toUpperCase()}] ${test.titlePath().join(' > ')}`,
    );
    this.lines.push(`  Duration: ${result.duration} ms`);

    if (result.error) {
      this.lines.push(`  Error: ${result.error.message ?? 'Unknown error'}`);
    }

    this.lines.push('');
  }

  onEnd(result: FullResult): void {
    this.lines.push(`Run status: ${result.status.toUpperCase()}`);
    this.lines.push(`Test run finished: ${new Date().toISOString()}`);

    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    fs.writeFileSync(this.outputFile, `${this.lines.join('\n')}\n`, 'utf8');
  }
}

export default TextReporter;