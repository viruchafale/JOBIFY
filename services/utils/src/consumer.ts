import { Kafka, Consumer } from "kafkajs";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

let consumer: Consumer | null = null;
let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT) || 465,
      secure: process.env.SMTP_SECURE !== "false",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

export const startSendMailConsumer = async () => {
  try {
    const kafka = new Kafka({
      clientId: "mail-service",
      brokers: [process.env.KAFKA_BROKER || "localhost:9092"],
      retry: {
        initialRetryTime: 300,
        retries: 5,
      },
    });

    consumer = kafka.consumer({ groupId: "mail-service-group" });
    await consumer.connect();
    const topicName = "send-mail";

    await consumer.subscribe({ topic: topicName, fromBeginning: false });

    console.log("📨 Mail service consumer started, listening for sending mail");

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const rawValue = message.value?.toString();
          if (!rawValue) return;

          const { to, subject, html } = JSON.parse(rawValue);
          if (!to || !subject) {
            console.warn("Skipping malformed mail message:", rawValue);
            return;
          }

          const mailClient = getTransporter();
          await mailClient.sendMail({
            from: process.env.SMTP_FROM || "JobiFy <no-reply@jobify.local>",
            to,
            subject,
            html,
          });
          console.log(`✅ Mail successfully sent to ${to}`);
        } catch (error) {
          console.error("❌ Failed to send mail:", error);
        }
      },
    });
  } catch (error) {
    console.error("⚠️ Failed to connect mail consumer to Kafka (will run without background mailer):", error);
  }
};

export const stopSendMailConsumer = async () => {
  if (consumer) {
    try {
      await consumer.disconnect();
      console.log("Kafka mail consumer disconnected.");
    } catch (err) {
      console.error("Error disconnecting Kafka consumer:", err);
    }
  }
};
