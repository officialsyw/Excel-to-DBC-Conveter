let excelFile = null; // excel file

  function openTab(tabName) {
    // Hide all tab contents with slide-out effect
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(content => {
      content.classList.remove('active');
      content.classList.add('slide-out');
    });

    // Remove active class from all buttons
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => button.classList.remove('active'));

    // Show the selected tab and mark the button as active
    const selectedTab = document.getElementById(tabName);
    selectedTab.classList.remove('slide-out');
    selectedTab.classList.add('active');
    const activeButton = document.querySelector(`.tab-button[onclick="openTab('${tabName}')"]`);
    activeButton.classList.add('active');

    // Move the slider to the active button
    const slider = document.querySelector('.slider');
    slider.style.left = activeButton.offsetLeft + 'px';
    slider.style.width = activeButton.offsetWidth + 'px';
  }

  document.addEventListener("DOMContentLoaded", function () {
    // Initialize the slider position
    const activeButton = document.querySelector('.tab-button.active');
    const slider = document.createElement('div');
    slider.classList.add('slider');
    slider.style.left = activeButton.offsetLeft + 'px';
    slider.style.width = activeButton.offsetWidth + 'px';
    document.querySelector('.navbar').appendChild(slider);

    const fileInput = document.getElementById("fileInput");
    const worksheetContainer = document.getElementById("worksheetCheckboxes");
    const promptBox = document.getElementById("promptBox");
    const clearInfoButton = document.getElementById("clearInfoButton");
    const generationOption = document.getElementById('generationOption').value;
    const generateValueTable = document.getElementById('generateValueTable').checked;

    // Handle file selection
    fileInput.addEventListener("change", handleFile);

    function handleFile(event) {
      const file = event.target.files[0];
      excelFile = file;
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function (e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });

        // Clear existing checkboxes
        worksheetContainer.innerHTML = "";

        // Populate new worksheet checkboxes
        workbook.SheetNames.forEach((sheetName) => {
          const label = document.createElement("label");
          const checkbox = document.createElement("input");

          checkbox.type = "checkbox";
          checkbox.value = sheetName;
          label.appendChild(checkbox);
          label.appendChild(document.createTextNode(sheetName));

          worksheetContainer.appendChild(label);
        });
        // Update the prompt box
        promptBox.value = "File uploaded successfully. Available sheets:\n" + workbook.SheetNames.join("\n") + "\n";
      };

      reader.readAsArrayBuffer(file);
    }

    // Clear information button functionality
    clearInfoButton.addEventListener("click", function () {
      // Clear input fields, checkboxes, and prompt box
      fileInput.value = "";
      worksheetContainer.innerHTML = "";
      document.getElementById("dbcPrefix").value = "";
      promptBox.value = "Information cleared." + "\n";
    });

    // Drag-and-drop functionality
    const dragDropArea = document.querySelector(".drag-drop");

    dragDropArea.addEventListener("dragover", (e) => {
      e.preventDefault();
      dragDropArea.style.backgroundColor = "#e9f5ff";
    });

    dragDropArea.addEventListener("dragleave", () => {
      dragDropArea.style.backgroundColor = "";
    });

    dragDropArea.addEventListener("drop", (e) => {
      e.preventDefault();
      dragDropArea.style.backgroundColor = "";
      const file = e.dataTransfer.files[0];
      excelFile = file;
      if (file) {
        fileInput.files = e.dataTransfer.files;
        handleFile({ target: { files: e.dataTransfer.files } });
      }
    });

    // Generate button functionality
    const generateButton = document.getElementById("generateButton");
    generateButton.addEventListener("click", async function () {
      const dbcPrefix = document.getElementById("dbcPrefix").value || "CAN_Msg";
      const selectedWorksheets = Array.from(document.querySelectorAll("#worksheetCheckboxes input[type='checkbox']:checked")).map((checkbox) => checkbox.value);
      const generationOption = document.getElementById('generationOption').value;
      const generateValueTable = document.getElementById('generateValueTable').checked;

      if (!fileInput.files.length) {
        appendMessage("Please upload an Excel file.");
        return;
      }

      if (selectedWorksheets.length === 0) {
        appendMessage("Please select at least one worksheet.");
        return;
      }

      appendMessage("Generating DBC files...");
      
      try {
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        formData.append('dbcPrefix', dbcPrefix);
        // Convert array to JSON string before appending
        formData.append('selectedWorksheets', JSON.stringify(selectedWorksheets));
        formData.append('generationOption', generationOption);
        formData.append('generateValueTable', generateValueTable);

        // Update the API endpoint URL to use relative path
        const response = await fetch('/api/converter', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error('Conversion failed');
        }

        const { files } = await response.json();
        
        // Download generated files
        files.forEach(file => {
            const blob = new Blob([file.content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.filename;
            a.click();
            URL.revokeObjectURL(url);
        });

        appendMessage("DBC files generated successfully.");
    } catch (error) {
        console.error('Error:', error);
        appendMessage("Failed to generate DBC files: " + error.message);
    }
    });
  });
  
  // Function to append message to the prompt box
  function appendMessage(message) {
    const promptBox = document.getElementById("promptBox");
    promptBox.value += message + "\n";
    promptBox.scrollTop = promptBox.scrollHeight; // Scroll to the bottom
  }

//   function downloadTemplate() {
//     // Use relative path to access the file from public folder
//     const templateUrl = '/template/CANMatrix_Demo.xlsx';
//     const promptBox = document.getElementById('promptBox');
    
//     fetch(templateUrl)
//         .then(response => {
//             if (!response.ok) {
//                 throw new Error('Network response was not ok');
//             }
//             return response.blob();
//         })
//         .then(blob => {
//             const url = window.URL.createObjectURL(blob);
//             const a = document.createElement('a');
//             a.href = url;
//             a.download = 'CANMatrix_Demo.xlsx';
//             document.body.appendChild(a);
//             a.click();
//             window.URL.revokeObjectURL(url);
//             document.body.removeChild(a);
//             promptBox.value = 'Template downloaded successfully!';
//         })
//         .catch(error => {
//             console.error('Error downloading template:', error);
//             promptBox.value = 'Error downloading template. Please try again later.';
//         });
// }
  function downloadTemplate() {
    window.open('https://www.dropbox.com/t/hXrX5iAJLEXQajcW', '_blank');
  }