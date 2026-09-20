CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runs_created_at_idx` ON `runs` (`created_at`);