import * as fs from 'fs'
import * as path from 'path'

/**
 * Iteratively searches for all files with the specified name, starting from a lookup directory.
 * @param lookupDir The directory to start the search from.
 * @param fileName The name of the file to look for.
 * @returns An array of paths to the found files, or an empty array if no files were found.
 */
export const findTFPlans = (lookupDir: string, planName: string): string[] => {
  const dirsToCheck: string[] = [lookupDir]
  const foundPaths: string[] = []

  while (dirsToCheck.length > 0) {
    const currentDir = dirsToCheck.shift()
    if (!currentDir) continue

    const entries = fs.readdirSync(currentDir)

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry)
      const stat = fs.statSync(fullPath)

      if (stat.isDirectory()) {
        // Add subdirectory to the queue to check later
        dirsToCheck.push(fullPath)
      } else if (entry === planName) {
        // Add the path to the found paths array
        foundPaths.push(fullPath)
      }
    }
  }

  // Return the array of found paths
  return foundPaths
}
