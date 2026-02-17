// Worker function that processes the job
export async function processSlackWebhook(data: any) {
  // Simulate some work being done
  // You can add your actual processing logic here
  console.log("Worker is processing job with data:", data);

  // Simulate async work
  await new Promise((resolve) => setTimeout(resolve, 100));

  console.log("Worker is done processing job");
}
