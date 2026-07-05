CREATE TABLE "smtp_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"host" text,
	"port" integer,
	"secure" boolean DEFAULT false NOT NULL,
	"user" text,
	"password_encrypted" text,
	"password_updated_at" timestamp,
	"from_address" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
