// The old address of the scan and alert logs, which now live under Logs.
export async function getServerSideProps() {
  return { redirect: { destination: '/logs?tab=scans', permanent: false } };
}
export default function Activity() { return null; }
