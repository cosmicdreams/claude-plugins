export default async function globalTeardown(): Promise<void> {
  if (process.env.EXAMPLE_TEARDOWN_THROWS === '1') throw new Error('EXAMPLE_GLOBAL_TEARDOWN_ERROR');
}
