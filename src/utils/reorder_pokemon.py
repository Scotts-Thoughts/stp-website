import re

def sort_pokemon_array(file_path):
    with open(file_path, 'r') as file:
        content = file.read()

    # Extract the array using regex
    array_pattern = re.compile(r'(\[.*?\])', re.DOTALL)
    array_match = array_pattern.search(content)
    
    if not array_match:
        print("Array not found in the file.")
        return

    array_str = array_match.group(1)
    
    # Extract the elements of the array
    elements_pattern = re.compile(r'"(.*?)"')
    elements = elements_pattern.findall(array_str)
    
    # Sort the elements
    sorted_elements = sorted(elements)
    
    # Create the sorted array string
    sorted_array_str = '[\n    "' + '",\n    "'.join(sorted_elements) + '"\n]'
    
    # Replace the old array with the sorted array in the content
    sorted_content = content.replace(array_str, sorted_array_str)
    
    # Write the sorted content back to the file
    with open(file_path, 'w') as file:
        file.write(sorted_content)

    print("Array sorted and file updated successfully.")

# Path to the file
file_path = 'E:/Dropbox/stp-projects/programs/stp-tierlist-generator/src/utils/pokemon.ts'
sort_pokemon_array(file_path)