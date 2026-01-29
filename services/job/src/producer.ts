import { Kafka, Producer, Admin } from "kafkajs";
import dotenv from "dotenv";
dotenv.config();

let producer: Producer;
let admin: Admin;

export const connectKafka = async () => {
  try {
    const kafka = new Kafka({
      clientId: "mail-service",
      brokers: [process.env.KAFKA_BROKER || "localhost:9092"],
    });
    admin = kafka.admin();
    await admin.connect();
    const topics = await admin.listTopics();
    if (!topics.includes("send-mail")) {
      await admin.createTopics({
        topics: [
          {
            topic: "send-mail",
            numPartitions: 1,
            replicationFactor: 1,
          },
        ],
      });
      console.log("✅ topic 'send-mail created");
    }

    await admin.disconnect();

    producer = kafka.producer();
    await producer.connect();
    console.log("✅ connect to kafka producer");
  } catch (error) {
    console.log("Failed to connect to kafka ", error);
  }
};

export const publishToTopic = async (topic: string, message: any) => {
  if (!producer) {
    console.log("kafka producer is not initialized");
  }

  try {
    await producer.send({
      topic: topic,
      messages: [{ value: JSON.stringify(message) }],
    });
  } catch (error) {
    console.log("Failed to publish message to kafka ", error);
  }
};


export const disconnectKafka =async ()=>{
  if (producer){
    producer.disconnect();
  }
}