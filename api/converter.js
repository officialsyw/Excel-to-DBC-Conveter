const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const cors = require('cors');
const path = require('path');
const iconv = require('iconv-lite');
const { sign } = require('crypto');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
// Add these lines to serve static files
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.static(path.join(__dirname, '../')));

app.post('/api/converter', upload.single('file'), async (req, res) => {
  try {
    const dbcPrefix = req.body.dbcPrefix || 'CAN_Msg';
    // Parse the JSON string back into an array
    const selectedWorksheets = JSON.parse(req.body.selectedWorksheets || '[]');
    const generationOption = req.body.generationOption || 'separately';
    const generateValueTable = req.body.generateValueTable === 'true';
    const encodingSelection = req.body.Encoding.toLowerCase() || 'utf8';

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('Selected Worksheets:', selectedWorksheets); // Debug log

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const timestamp = new Date().toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).replace(/[/:]/g, '.').replace(', ', '_');

    let results = [];

    if (generationOption === 'separately') {
      // Generate separate DBC files
      for (const sheetName of selectedWorksheets) {
        const GenDBCName = `${dbcPrefix}_${sheetName}_${timestamp}`;
        const { RetResult, MsgInfo } = await GetCANMsgInfo(workbook, sheetName);

        if (RetResult === 0) {
          continue;
        }

        const sortedMsgInfo = sortMsgInfo(MsgInfo);
        if (!sortedMsgInfo) {
          continue;
        }

        const commonInfo = getCommonInfo(GenDBCName, MsgInfo.Node);
        if (!commonInfo) {
          continue;
        }

        const dbcContent = generateDBCContent(
          commonInfo,
          sortedMsgInfo,
          generateValueTable
        );

        results.push({
          filename: `${GenDBCName}.dbc`,
          content: dbcContent
        });
      }
    } else {
      // Generate combined DBC file
      const Combine_MsgContent = {
        Node: [],
        MsgList: []
      };

      let Combined_GenDBCName = '';
      for (const sheetName of selectedWorksheets) {
        Combined_GenDBCName = `${Combined_GenDBCName}_${sheetName}`;
        const { RetResult, MsgInfo } = await GetCANMsgInfo(workbook, sheetName);

        if (RetResult === 1) {
          // Combine nodes and messages
          MsgInfo.Node.forEach(node => {
            if (!Combine_MsgContent.Node.includes(node)) {
              Combine_MsgContent.Node.push(node);
            }
          });

          MsgInfo.MsgList.forEach(msg => {
            if (!Combine_MsgContent.MsgList.find(m => m.ID === msg.ID)) {
              Combine_MsgContent.MsgList.push(msg);
            }
          });
        }
      }

      const GenDBCName = `${dbcPrefix}${Combined_GenDBCName}_${timestamp}`;
      const sortedMsgInfo = sortMsgInfo(Combine_MsgContent);
      const commonInfo = getCommonInfo(GenDBCName, Combine_MsgContent.Node);

      if (sortedMsgInfo && commonInfo) {
        const dbcContent = generateDBCContent(
          commonInfo,
          sortedMsgInfo,
          generateValueTable
        );

        results.push({
          filename: `${GenDBCName}.dbc`,
          content: dbcContent
        });
      }
    }

    // const encodeContentbuffer = iconv.encode(results.content, encodingSelection);
    // results.content = encodeContentbuffer.toString();
    // res.json({ files: results });
    const encodedFiles = results.map(file => ({
      filename: file.filename,
      content: iconv.encode(file.content, encodingSelection).toString('binary') // Key Change: binary
    }));
    res.json({ files: encodedFiles });
  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).json({ error: 'Conversion failed' });
  }
});

function generateDBCContent(commonInfo, sortedMsgInfo, generateValueTable) {
  const eol = '\n';
  let content = commonInfo.Header_content + commonInfo.BU_Content + eol;
  content += sortedMsgInfo.BO_SG_Content + eol;
  content += sortedMsgInfo.CM_BO_SG_Content + eol;
  content += commonInfo.BA_DEF_Content;
  content += commonInfo.BA_Content;
  content += sortedMsgInfo.BA_BO_Content;
  content += sortedMsgInfo.BA_SG_Content;

  if (generateValueTable) {
    content += eol + sortedMsgInfo.VAL_Content + eol;
  }

  return content;
}

// Keep existing helper functions
function GetCANMsgInfo(workbook, sheetName) {
  return new Promise((resolve) => {
    const MsgInfo = {
      Node: [],
      MsgList: []
    };

    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      console.log(`Sheet ${sheetName} not found`);
      resolve({ RetResult: 0, MsgInfo });
      return;
    }

    const range = XLSX.utils.decode_range(worksheet['!ref']);
    const numRows = range.e.r - range.s.r + 1;
    const numCols = range.e.c - range.s.c + 1;

    console.log(`Sheet ${sheetName} has ${numRows} rows and ${numCols} columns`);

    if (numRows < 4) {
      console.log(`Sheet ${sheetName} has too few rows, possibly no signal definitions!`);
      resolve({ RetResult: 0, MsgInfo });
      return;
    } else if (numCols < 22) {
      console.log(`Sheet ${sheetName} has too few columns, possibly not a standard matrix template!`);
      resolve({ RetResult: 0, MsgInfo });
      return;
    }

    const CAN_Matrix_Text = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: true,
      defval: ''
    });

    // Rest of the function remains the same, just remove appendMessage calls
    // and replace them with console.log
    const headers = [
      'Msg Name', 'Msg Type', 'Msg ID(Hex)', 'Msg Send Type', 'Msg Cycle Time (ms)', 'Msg Length (Byte)',
      'Signal Name', 'Signal Description', 'Signal Value Description', 'Byte Order', 'Start Byte', 'Start Bit',
      'Signal Send Type', 'Bit Length (Bit)', 'Data Type', 'Resolution', 'Offset', 'Signal Min. Value (phys)',
      'Signal Max. Value(phys)', 'Initial Value(Hex)', 'Invalid Value(Hex)', 'Unit'
    ];

    let Err_content = '';
    headers.forEach((header, index) => {
      const cellValue = CAN_Matrix_Text[0][index] || '';
      if (!cellValue.includes(header)) {
        Err_content += `-- Column ${String.fromCharCode(65 + index)} should be ${header}, got "${cellValue}", please check!!!\n`;
      }
    });

    if (Err_content) {
      console.log(Err_content);
      resolve({ RetResult: 0, MsgInfo });
      return;
    }

    if (numCols > 22) {
      for (let nodeIndex = 22; nodeIndex < numCols; nodeIndex++) {
        let value = CAN_Matrix_Text[1][nodeIndex];
        console.log(`Node value at column ${nodeIndex}:`, value);
        if (value !== null && value !== undefined && value !== '') {
          MsgInfo.Node.push(value.toString());
        }
      }
    }

    console.log("Found nodes:", MsgInfo.Node);

    // Process messages and signals
    let currentMsg = null;

    for (let row_index = 2; row_index < numRows; row_index++) {
      const Message_Text = CAN_Matrix_Text[row_index];

      // Skip empty rows
      if (!Message_Text || Message_Text.every(cell => !cell)) {
        continue;
      }

      const [
        MsgName, MsgType, MsgID, MsgSendType, MsgCycleTime, MsgLength,
        SignalName, Comment, ValueDesc, ByteOrder, StartByte, StartBit,
        SendType, Length, DataType, Factor, Offset, Min, Max,
        InitValue, InvalidValue, Unit
      ] = Message_Text;

      // If we have a message ID, process message
      if (MsgID) {
        console.log(`Processing message: Name=${MsgName}, ID=${MsgID}`);

        // Convert hex string to number properly
        let idValue;
        if (typeof MsgID === 'string' && MsgID.toLowerCase().startsWith('0x')) {
          idValue = parseInt(MsgID.slice(2), 16);
        } else if (typeof MsgID === 'number') {
          idValue = MsgID;
        } else {
          idValue = parseInt(MsgID, 16);
        }

        if (isNaN(idValue) || idValue > 0x1FFFFFFF) {
          console.log(`Invalid message ID: ${MsgID}`);
          continue;
        }

        // Create message object
        const MsgIDStr = idValue > 0x7FF ? String(idValue + 0x80000000) : String(idValue);

        currentMsg = {
          ID: MsgIDStr,
          Name: MsgName,
          Type: MsgType,
          SendType: MsgSendType ?? "Cycle",
          CycleTime: MsgCycleTime,
          Length: MsgLength,
          Desc: Comment ?? "",
          Receiver: '',
          Sender: '',
          SigList: []
        };

        // Process sender node
        for (let SendNodeIdex = 22; SendNodeIdex < numCols; SendNodeIdex++) {
          const MsgNodeStStr = Message_Text[SendNodeIdex];
          if (MsgNodeStStr && typeof MsgNodeStStr === 'string') {
            const nodeStr = MsgNodeStStr.trim().toUpperCase();
            if (nodeStr === 'S') {
              currentMsg.Sender = MsgInfo.Node[SendNodeIdex - 22];
              break;
            }
          }
        }

        MsgInfo.MsgList.push(currentMsg);
        console.log(`Added message: ${currentMsg.Name} (ID: ${currentMsg.ID})`);
      }

      // If we have a signal name, process signal
      if (SignalName && currentMsg) {
        console.log(`Processing signal: ${SignalName} for message ${currentMsg.Name}`);

        const signal = {
          Name: SignalName,
          Desc: Comment ?? "",
          ValDesc: ValueDesc ?? "",
          ByteOrder: ByteOrder ?? "Intel",
          StartByte: StartByte,
          StartBit: StartBit,
          SendType: SendType ?? "Cycle",
          Length: Length,
          DataType: DataType,
          Factor: Factor || 1,
          Offset: Offset || 0,
          PhyMin: Min,
          PhyMax: Max,
          InitValue: InitValue ?? "0x0",
          InvalidValue: InvalidValue ?? "",
          Unit: Unit ?? "",
          Receiver: ''
        };

        // Process receiver nodes
        let RcvNode = [];
        for (let RcvNodeIdex = 22; RcvNodeIdex < numCols; RcvNodeIdex++) {
          const SigNodeStStr = Message_Text[RcvNodeIdex];
          if (SigNodeStStr && typeof SigNodeStStr === 'string') {
            const nodeStr = SigNodeStStr.trim().toUpperCase();
            if (nodeStr === 'R' && MsgInfo.Node[RcvNodeIdex - 22] !== currentMsg.Sender) {
              RcvNode.push(MsgInfo.Node[RcvNodeIdex - 22]);
            }
          }
        }
        signal.Receiver = RcvNode.join(',');

        currentMsg.SigList.push(signal);
        console.log(`Added signal: ${signal.Name} to message ${currentMsg.Name}`);
      }
    }

    console.log("Final MsgInfo:", MsgInfo);
    resolve({ RetResult: 1, MsgInfo });
  });
}

function sortMsgInfo(CANMsgInfo) {

  const eol = '\n';
  let BO_SG_Content = '';
  let CM_BO_SG_Content = '';
  let BA_BO_Content = '';
  let BA_SG_Content = '';
  let VAL_Content = '';

  try {
    // Validate input
    if (!CANMsgInfo || !Array.isArray(CANMsgInfo.MsgList)) {
      console.error('Invalid CANMsgInfo structure');
      return null;
    }

    // Sort messages by ID
    CANMsgInfo.MsgList.sort((a, b) => parseInt(a.ID) - parseInt(b.ID));

    // BO_SG section
    for (let BO_Index = 0; BO_Index < CANMsgInfo.MsgList.length; BO_Index++) {
      const msg = CANMsgInfo.MsgList[BO_Index];

      // Validate message
      if (!msg || !msg.ID || !msg.Name || !msg.Length) {
        console.error(`Invalid message at index ${BO_Index}:`, msg);
        continue;
      }

      let Sender = msg.Sender || 'Vector__XXX';

      // Format message header line
      BO_SG_Content += `BO_ ${msg.ID} ${msg.Name}: ${msg.Length} ${Sender}${eol}`;

      // Process signals
      if (Array.isArray(msg.SigList)) {
        // Sort signals by start bit
        msg.SigList.sort((a, b) => parseInt(a.StartBit) - parseInt(b.StartBit));

        for (const signal of msg.SigList) {
          try {
            // Validate signal data
            if (!signal.Name || !signal.ByteOrder ||
              !signal.Length || !signal.DataType) {
              console.error('Signal has missing required fields:', signal);
              continue;
            }

            // Default values for optional fields
            signal.Factor = signal.Factor || 1;
            signal.Offset = signal.Offset || 0;
            signal.PhyMin = signal.PhyMin || 0;
            signal.PhyMax = signal.PhyMax || 0;

            let StartBitHndl;
            let ByteOrderStr;

            // Process byte order and start bit
            if (signal.ByteOrder.toLowerCase() === 'intel') {
              StartBitHndl = parseInt(signal.StartBit);
              ByteOrderStr = '1';

              if (StartBitHndl + parseInt(signal.Length) > 64) {
                console.error(`Signal ${signal.Name} start bit and length exceed bounds`);
                continue;
              }
            } else if (
              signal.ByteOrder.toLowerCase() === 'motorola lsb'
            ) {
              const startBit = parseInt(signal.StartBit);

              if (startBit < 0 || startBit > 63) {
                console.error(`Signal ${signal.Name} start bit out of range`);
                continue;
              }

              // Create Motorola LSB matrix
              const LSB = Array(8)
                .fill()
                .map((_, i) =>
                  Array(8)
                    .fill()
                    .map((_, j) => 8 * (i + 1) - (j + 1))
                );

              LSBIdx = LSB.flat().indexOf(startBit) + 1 - parseInt(signal.Length);

              if (LSBIdx < 0 || LSBIdx > 63) {
                console.error(`Signal ${signal.Name} matrix index out of bounds`);
                continue;
              }

              StartBitHndl = LSB.flat()[LSBIdx];
              ByteOrderStr = '0';
            } else if (signal.ByteOrder.toLowerCase() === 'motorola' ||
              signal.ByteOrder.toLowerCase() === 'motorola msb') {
              StartBitHndl = parseInt(signal.StartBit);
              ByteOrderStr = '0';

              if (StartBitHndl > 63) {
                console.error(`Signal ${signal.Name} start bit and length exceed bounds`);
                continue;
              }
            } else {
              console.error(`Signal ${signal.Name} has unsupported byte order: ${signal.ByteOrder}`);
              continue;
            }

            // Process data type
            const DataType = signal.DataType.toLowerCase() === 'unsigned' ? '+ ' : '- ';

            // Process unit
            let Unit = signal.Unit || '';
            if (Unit === '%') {
              Unit = '%%%%';
            }

            // Process receiver
            const Receiver = signal.Receiver || 'Vector__XXX';

            // Format signal line
            BO_SG_Content += ` SG_ ${signal.Name} : ${StartBitHndl}|${signal.Length}@${ByteOrderStr}${DataType}(${signal.Factor},${signal.Offset}) [${signal.PhyMin}|${signal.PhyMax}] "${Unit}" ${Receiver}${eol}`;
          } catch (error) {
            console.error(`Error processing signal ${signal.Name}:`, error);
          }
        }
        BO_SG_Content += eol;
      }
    }

    // CM_BO_SG section (comments)
    for (let BO_Index = 0; BO_Index < CANMsgInfo.MsgList.length; BO_Index++) {
      if (CANMsgInfo.MsgList[BO_Index].Desc) {
        let MsgDesc = CANMsgInfo.MsgList[BO_Index].Desc;
        if (typeof MsgDesc === 'number') {
          MsgDesc = MsgDesc.toString();
        }
        if (MsgDesc.includes('%')) {
          MsgDesc = MsgDesc.replace(/%/g, '%%%%');
        }
        CM_BO_SG_Content += `CM_ BO_ ${CANMsgInfo.MsgList[BO_Index].ID} "${MsgDesc}";${eol}`;
      }

      // Signal comments
      CANMsgInfo.MsgList[BO_Index].SigList.forEach(signal => {
        if (signal.Desc) {
          let SigDesc = signal.Desc;
          if (typeof SigDesc === 'number') {
            SigDesc = SigDesc.toString();
          }
          if (SigDesc.includes('%')) {
            SigDesc = SigDesc.replace(/%/g, '%%%%');
          }
          CM_BO_SG_Content += `CM_ SG_ ${CANMsgInfo.MsgList[BO_Index].ID} ${signal.Name} "${SigDesc}";${eol}`;
        }
      });
    }

    // BA_BO section (message attributes) 
    for (let BO_Index = 0; BO_Index < CANMsgInfo.MsgList.length; BO_Index++) {
      const msg = CANMsgInfo.MsgList[BO_Index];
      const MsgCycleTime = parseInt(msg.CycleTime);

      // Add Standard Frame Support
      if (msg.ID <= 0x7FF) {
        BA_BO_Content += `BA_ "VFrameFormat" BO_ ${msg.ID} 0;${eol}`;
      }

      if (msg.SendType.toLowerCase() === 'ifactive') {
        BA_BO_Content += `BA_ "GenMsgSendType" BO_ ${msg.ID} 7;${eol}`;
      } else if (msg.SendType.toLowerCase() === 'cycle' && !isNaN(MsgCycleTime)) {
        BA_BO_Content += `BA_ "GenMsgCycleTime" BO_ ${msg.ID} ${MsgCycleTime};${eol}`;
        BA_BO_Content += `BA_ "GenMsgSendType" BO_ ${msg.ID} 0;${eol}`;
      }
    }

    // BA_SG section (signal attributes)
    CANMsgInfo.MsgList.forEach((msg) => {
      msg.SigList.forEach((signal) => {
        try {
          // 强制类型转换与默认值处理
          const initValue = String(signal.InitValue ?? '0').trim();
          const factorStr = String(signal.Factor ?? '').trim();
          const offsetStr = String(signal.Offset ?? '0').trim();

          // 必要参数校验
          if (!factorStr) throw new Error(`Factor为必填项，信号名: ${signal.Name}`);
          const factor = parseFloat(factorStr);
          if (isNaN(factor)) throw new Error(`无效的Factor数值: ${factorStr}`);
          if (factor === 0) throw new Error(`Factor不能为零，信号名: ${signal.Name}`);
          const offset = parseFloat(offsetStr) || 0;

          // 数值解析核心逻辑
          let numericValue;
          const lowerInit = initValue.toLowerCase();

          // 增强版十六进制正则（支持负号、0x前缀、纯十六进制字符）
          if (/^-?(0x)?[0-9a-f]+$/i.test(initValue)) {
            // 分离符号与数值部分
            let sign = 1;
            let processedValue = lowerInit;
            if (processedValue.startsWith('-')) {
              sign = -1;
              processedValue = processedValue.slice(1); // 移除负号
            }

            // 提取有效十六进制部分
            const hexValue = processedValue.startsWith('0x')
              ? processedValue.slice(2)
              : processedValue;

            // 执行十六进制转换
            const unsignedValue = parseInt(hexValue, 16);
            if (isNaN(unsignedValue)) {
              throw new Error(`十六进制转换失败: ${hexValue}`);
            }
            numericValue = unsignedValue * sign; // 应用符号
          } else {
            // 十进制转换（支持负数、浮点数）
            numericValue = parseFloat(initValue);
            if (isNaN(numericValue)) {
              throw new Error(`无效的数值格式: ${initValue}`);
            }
          }

          // 计算结果并生成输出
          const IV = (numericValue - offset) / factor;
          BA_SG_Content += `BA_ "GenSigStartValue" SG_ ${msg.ID} ${signal.Name} ${IV};${eol}`;
        } catch (error) {
          console.error(`[信号处理错误 ${signal.Name}]: ${error.message}`);
        }
      });
    });

    // CANMsgInfo.MsgList.forEach(msg => {
    //   msg.SigList.forEach(signal => {
    //     signal.InitValue = signal.InitValue ?? "0";
    //     signal.Factor = signal.Factor || "1";
    //     signal.Offset = signal.Offset || "0";

    //     const factor = parseFloat(signal.Factor);
    //     if (factor === 0) {
    //       console.error(`Factor is zero for signal ${signal.Name}`);
    //       return;
    //     }

    //     let Ini_Val_Num;
    //     if (signal.InitValue.toLowerCase().includes('0x')) {
    //       const hex = signal.InitValue.toLowerCase().split('x')[1];
    //       if (/^[0-9a-f]+$/i.test(hex)) {
    //         Ini_Val_Num = parseInt(hex, 16);
    //       } else {
    //         return;
    //       }
    //     } else if (/^[0-9a-f]+$/i.test(signal.InitValue)) {
    //       Ini_Val_Num = parseInt(signal.InitValue, 16);
    //     } else {
    //     //   console.error(`Invalid InitValue: ${signal.InitValue}`);
    //     //   return;
    //     // }

    //     // // 处理十六进制（0x1A 或 1A）
    //     // let hexMatch = signal.InitValue.toLowerCase().match(/^-?0x([0-9a-f]+)$|^-?([0-9a-f]+)$/i);
    //     // let Ini_Val_Num;
    //     // // 长度检测 Length Check
    //     // if (hexMatch) {
    //     //   const hex = hexMatch[1] || hexMatch[2];
    //     //   if (hex.length > 8) {
    //     //     console.error(`Hex value too long: ${signal.InitValue}`);
    //     //     return;
    //     //   }
    //     //   Ini_Val_Num = parseInt(hex, 16);
    //     //   if (signal.InitValue.startsWith('-')) Ini_Val_Num *= -1;
    //     // } else if (/^-?\d+$/.test(signal.InitValue)) {
    //     //   Ini_Val_Num = parseInt(signal.InitValue, 10);
    //     // } else {
    //       console.error(`Invalid InitValue: ${signal.InitValue}`);
    //       return;
    //     }

    //     const IV = (Ini_Val_Num - parseFloat(signal.Offset)) / parseFloat(signal.Factor);
    //     BA_SG_Content += `BA_ "GenSigStartValue" SG_ ${msg.ID} ${signal.Name} ${IV};${eol}`;
    //   });
    // });

    // VAL section (value descriptions)
    CANMsgInfo.MsgList.forEach(msg => {
      msg.SigList.forEach(signal => {
        if (signal.ValDesc && typeof signal.ValDesc === 'string') {
          const values = signal.ValDesc.split('\n');
          let ValDesc = '';

          values.forEach(value => {
            let parts;
            if (value.includes(':')) {
              parts = value.split(':');
            } else if (value.includes('：')) {
              parts = value.split('：');
            } else if (value.includes('=')) {
              parts = value.split('=');
            } else {
              return;
            }

            if (parts.length !== 2) return;

            let [valNum, descText] = parts.map(p => p.trim());
            let numStr;

            if (valNum.toLowerCase().includes('0x')) {
              const hex = valNum.toLowerCase().split('x')[1];
              if (/^[0-9a-f]+$/i.test(hex)) {
                numStr = parseInt(hex, 16).toString();
              } else {
                return;
              }
            } else if (/^[0-9]+$/.test(valNum)) {
              numStr = valNum;
            } else {
              return;
            }

            ValDesc += `${ValDesc ? ' ' : ''}${numStr} "${descText.replace(/%/g, '%%%%')}"`;
          });

          if (ValDesc) {
            VAL_Content += `VAL_ ${msg.ID} ${signal.Name} ${ValDesc};${eol}`;
          }
        }
      });
    });
  } catch (error) {
    console.error('Error sorting message info:', error);
    return null;
  }

  return {
    BO_SG_Content,
    CM_BO_SG_Content,
    BA_BO_Content,
    BA_SG_Content,
    VAL_Content
  };
}

function getCommonInfo(DBCFileName, MsgNode) {
  // ...existing code...
  const eol = '\n';

  // Initialize header content
  let Header_content = `VERSION ""${eol}${eol}${eol}`;
  Header_content += `NS_ :${eol}`;

  // Add header sections in specific order
  const headerSections = [
    'NS_DESC_', 'CM_', 'BA_DEF_', 'BA_', 'VAL_',
    'CAT_DEF_', 'CAT_', 'FILTER', 'BA_DEF_DEF_',
    'EV_DATA_', 'ENVVAR_DATA_', 'SGTYPE_',
    'SGTYPE_VAL_', 'BA_DEF_SGTYPE_', 'BA_SGTYPE_',
    'SIG_TYPE_REF_', 'VAL_TABLE_', 'SIG_GROUP_',
    'SIG_VALTYPE_', 'SIGTYPE_VALTYPE_', 'BO_TX_BU_',
    'BA_DEF_REL_', 'BA_REL_', 'BA_DEF_DEF_REL_',
    'BU_SG_REL_', 'BU_EV_REL_', 'BU_BO_REL_',
    'SG_MUL_VAL_'
  ];

  headerSections.forEach(section => {
    Header_content += `\t${section}${eol}`;
  });

  // Add BS_ section
  Header_content += `${eol}BS_:${eol}${eol}`;

  // BU_ section - network nodes definition
  let MessageNode = '';
  MsgNode.forEach(node => {
    MessageNode += ` ${node}`;
  });
  const BU_Content = `BU_:${MessageNode}${eol}`;

  // BA_DEF_ section
  let BA_DEF_Content = '';

  // Network attributes
  const networkAttrs = [
    ['BusType', 'STRING'],
    ['ProtocolType', 'STRING'],
    ['DBName', 'STRING'],
    ['Manufacturer', 'STRING']
  ];

  networkAttrs.forEach(([name, type]) => {
    BA_DEF_Content += `BA_DEF_ "${name}" ${type};${eol}`;
  });

  // Node attributes
  const nodeAttrs = [
    ['ECU', 'STRING'],
    ['NmStationAddress', 'INT', '0', '254'],
    ['NmJ1939AAC', 'INT', '0', '1'],
    ['NmJ1939IndustryGroup', 'INT', '0', '7'],
    ['NmJ1939System', 'INT', '0', '127'],
    ['NmJ1939SystemInstance', 'INT', '0', '15'],
    ['NmJ1939Function', 'INT', '0', '255'],
    ['NmJ1939FunctionInstance', 'INT', '0', '7'],
    ['NmJ1939ECUInstance', 'INT', '0', '3'],
    ['NmJ1939ManufacturerCode', 'INT', '0', '2047'],
    ['NmJ1939IdentityNumber', 'INT', '0', '2097151']
  ];

  nodeAttrs.forEach(attr => {
    const [name, type, ...range] = attr;
    BA_DEF_Content += `BA_DEF_ BU_ "${name}" ${type}${range.length ? ' ' + range.join(' ') : ''};${eol}`;
  });

  // Signal attributes
  const sigTypeEnum = '"Default","Range","RangeSigned","ASCII","Discrete","Control","ReferencePGN","DTC",' +
    '"StringDelimiter","StringLength","StringLengthControl","MessageCounter","MessageChecksum"';
  BA_DEF_Content += `BA_DEF_ SG_ "SigType" ENUM ${sigTypeEnum};${eol}`;
  BA_DEF_Content += `BA_DEF_ SG_ "SPN" INT 0 524287;${eol}`;
  BA_DEF_Content += `BA_DEF_ SG_ "GenSigILSupport" ENUM "No","Yes";${eol}`;

  const sendTypeEnum = '"Cyclic","OnWrite","OnWriteWithRepetition","OnChange","OnChangeWithRepetition",' +
    '"IfActive","IfActiveWithRepetition","NoSigSendType"';
  BA_DEF_Content += `BA_DEF_ SG_ "GenSigSendType" ENUM ${sendTypeEnum};${eol}`;
  BA_DEF_Content += `BA_DEF_ SG_ "GenSigInactiveValue" INT 0 1000000;${eol}`;
  BA_DEF_Content += `BA_DEF_ SG_ "GenSigStartValue" INT 0 65535;${eol}`;
  BA_DEF_Content += `BA_DEF_ SG_ "GenSigEVName" STRING;${eol}`;

  // BA_DEF_Content += `BA_DEF_ SG_ "GenSigUnitText" STRING ;${eol}`;
  // BA_DEF_Content += `BA_DEF_ SG_ "GenSigTimeoutValue" INT 0 1000;${eol}`;
  // BA_DEF_Content += `BA_DEF_ SG_ "GenSigTimeoutMsg" ENUM "No","Yes";${eol}`;
  // BA_DEF_Content += `BA_DEF_ SG_ "GenSigAutoGenDsp" ENUM "No","Yes";${eol}`;
  // BA_DEF_Content += `BA_DEF_ SG_ "GenSigAutoGenSnd" ENUM "No","Yes";${eol}`;
  // BA_DEF_Content += `BA_DEF_ SG_ "GenSigEnvVarType" ENUM "Integer","Float";${eol}`;

  // Message attributes
  const msgAttrs = [
    ['GenMsgILSupport', 'ENUM', '"No","Yes"'],
    ['GenMsgSendType', 'ENUM', '"Cyclic","NotUsed","NotUsed","NotUsed","NotUsed","NotUsed","NotUsed","IfActive","noMsgSendType"'],
    ['GenMsgDelayTime', 'INT', '0', '1000'],
    ['GenMsgStartDelayTime', 'INT', '0', '100000'],
    ['GenMsgFastOnStart', 'INT', '0', '1000000'],
    ['GenMsgNrOfRepetition', 'INT', '0', '1000000'],
    ['GenMsgCycleTime', 'INT', '0', '60000'],
    ['GenMsgCycleTimeFast', 'INT', '0', '1000000'],
    ['GenMsgRequestable', 'INT', '0', '1'],
    ['VFrameFormat', 'ENUM', '"StandardCAN","ExtendedCAN","reserved","J1939PG"'],

    // ... add other message attributes
    // ['GenMsgTimeoutTime', 'INT', '0', '1000'],
    // ['GenMsgMinGap', 'INT', '0', '1000'], // need check
    // ['GenMsgAutoGenDsp', 'ENUM', '"No","Yes"'],
    // ['GenMsgAutoGenSnd', 'ENUM', '"No","Yes"'],
    // ['GenMsgEVName', 'STRING'],
    // ['GenMsgAltSetting', 'STRING']

  ];

  msgAttrs.forEach(([name, type, ...params]) => {
    BA_DEF_Content += `BA_DEF_ BO_ "${name}" ${type} ${params.join(' ')};${eol}`;
  });

  // Default definitions section
  const defaults = [
    // Network defaults
    ['BusType', '""'],
    ['ProtocolType', '""'],
    ['DBName', '""'],
    ['Manufacturer', '"Vector"'],
    // Node defaults
    ['ECU', '""'],
    ['NmStationAddress', '254'],
    ['NmJ1939AAC', '0'],
    ['NmJ1939IndustryGroup', '0'],
    ['NmJ1939System', '0'],
    ['NmJ1939SystemInstance', '0'],
    ['NmJ1939Function', '0'],
    ['NmJ1939FunctionInstance', '0'],
    ['NmJ1939ECUInstance', '0'],
    ['NmJ1939ManufacturerCode', '0'],
    ['NmJ1939IdentityNumber', '0'],
    // Signal defaults (complete list)
    ['SigType', '"Default"'],
    ['SPN', '0'],
    ['GenSigILSupport', '"Yes"'],
    ['GenSigSendType', '"NoSigSendType"'],
    ['GenSigInactiveValue', '0'],
    ['GenSigStartValue', '0'],
    ['GenSigEVName', '"Env@Nodename_@Signame"'],
    // ['GenSigUnitText', '""'],
    // ['GenSigTimeoutValue', '0'],
    // ['GenSigTimeoutMsg', '"No"'],
    // ['GenSigAutoGenDsp', '"No"'],
    // ['GenSigAutoGenSnd', '"No"'],
    // ['GenSigEnvVarType', '"Integer"'],
    ['GenMsgILSupport', '"Yes"'],
    // Message defaults (complete list)
    ['GenMsgSendType', '"noMsgSendType"'],
    ['GenMsgDelayTime', '0'],
    ['GenMsgStartDelayTime', '0'],
    ['GenMsgFastOnStart', '0'],
    ['GenMsgNrOfRepetition', '0'],
    ['GenMsgCycleTime', '0'],
    ['GenMsgCycleTimeFast', '0'],
    ['GenMsgRequestable', '1'],
    ['VFrameFormat', '"ExtendedCAN"'],
    // ['GenMsgTimeoutTime', '0'],
    // ['GenMsgMinGap', '0'],
    // ['GenMsgAutoGenDsp', '"No"'],
    // ['GenMsgAutoGenSnd', '"No"'],
    // ['GenMsgEVName', '"Env@Nodename_@Msgname"'],
    // ['GenMsgAltSetting', '""']
    // ... add other defaults
  ];

  defaults.forEach(([name, value]) => {
    BA_DEF_Content += `BA_DEF_DEF_ "${name}" ${value};${eol}`;
  });

  // BA_ section
  let BA_Content = `BA_ "ProtocolType" "";${eol}`;
  BA_Content += `BA_ "Manufacturer" "ShenyanWu";${eol}`;
  BA_Content += `BA_ "BusType" "CAN";${eol}`;
  BA_Content += `BA_ "DBName" "${DBCFileName}";${eol}`;

  return {
    Header_content,
    BU_Content,
    BA_DEF_Content,
    BA_Content
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

