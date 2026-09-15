import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const PEOPLE_DIR = fileURLToPath(new URL("../src/data/people/", import.meta.url));

export const packPerson = (generatedAt, entries) => {
	const j = JSON.stringify;
	return `{\n  "generatedAt": ${j(generatedAt)},\n  "entries": [\n${entries.map((e) => `    ${j(e)}`).join(",\n")}\n  ]\n}\n`;
};

export async function readPeopleFiles() {
	const files = await readdir(PEOPLE_DIR).catch((err) => {
		if (err.code === "ENOENT") return [];
		throw err;
	});
	const result = {};
	for (const filename of files.filter((name) => name.endsWith(".json"))) {
		result[filename.slice(0, -5)] = JSON.parse(
			await readFile(new URL(`../src/data/people/${filename}`, import.meta.url), "utf8"),
		);
	}
	return result;
}

export async function writePerson(username, generatedAt, entries) {
	await mkdir(PEOPLE_DIR, { recursive: true });
	const path = new URL(`../src/data/people/${username}.json`, import.meta.url);
	const old = await readFile(path, "utf8").catch((err) => {
		if (err.code === "ENOENT") return null;
		throw err;
	});
	const previousDate = old ? JSON.parse(old).generatedAt : null;
	if (old === packPerson(previousDate, entries)) return false;
	await writeFile(path, packPerson(generatedAt, entries));
	return true;
}
