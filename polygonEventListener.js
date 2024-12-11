const ethers = require('ethers');
const admin = require('firebase-admin');
const serviceAccount = require('./aki-protocol-dev.json'); 
const abi = require('./abi.json');

// 初始化 Firebase
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

const provider = new ethers.WebSocketProvider('wss://sparkling-wild-pallet.matic.quiknode.pro/fff3498b3cded5daedf5646d6a70f8c5328c327a');

const contractAddress = '0xf6178e2d92EaECa528eCF9f428bFeD2D5d92dEF2';

const polygonContract = new ethers.Contract(contractAddress, abi, provider);
const db = admin.firestore();
const akiUsersCollection = 'akiUsers';
const airdropsCollection = 'airdrops';

// 更新用户权限
const updateUserPermission = async (userAddress, permissionLevel) => {
    const querySnapshot = await db.collection(akiUsersCollection)
        .where('wallet.address', '==', userAddress.toUpperCase())
        .get();

    if (querySnapshot.empty) {
        console.log('没有找到匹配的用户文档');
        return { code: -1, message: '未找到匹配的用户文档' };
    }

    const doc = querySnapshot.docs[0];
    const newField = { permissionLevel };
    await doc.ref.update(newField);
    console.log(`用户文档 ${doc.id} 已更新权限等级为 ${permissionLevel}`);
    return { code: 0, message: `用户文档 ${doc.id} 权限等级已更新为 ${permissionLevel}`, userId: doc.id };
};

// 更新 airdrop 子文档的 listed 状态
const updateAirdropListedStatus = async (userId) => {
    const airdropSnapshot = await db.collectionGroup('airdrops')
        .where('owner_id', '==', userId)
        .get();

    if (airdropSnapshot.empty) {
        console.log('没有找到匹配的 airdrop 文档');
        return { code: -1, message: '未找到匹配的 airdrop 文档' };
    }

    const batch = db.batch();

    airdropSnapshot.forEach(doc => {
        const docRef = doc.ref;
        batch.update(docRef, { listed: false });
        console.log(`已更新 airdrop 文档 ${doc.id} 的 listed 为 false`);
    });

    await batch.commit();
    console.log(`所有匹配的 airdrop 文档已更新`);
    return { code: 0, message: '所有 airdrop 文档的 listed 状态已更新为 false' };
};

// 处理用户权限和 airdrop 状态更新的函数
const handleUserPermissionAndAirdropUpdate = async (account) => {
    const permissionLevel = 0;
    const { userId } = await updateUserPermission(account, permissionLevel);
    if (userId) {
        await updateAirdropListedStatus(userId);
    }
};

// 监听事件并处理出错的情况
const listenForEvents = () => {
    try {
        // 监听 Staked 事件
        polygonContract.on('Staked', async (account, amount) => {
            try {
                console.log(`检测到 Staked 事件: 用户 ${account} 质押了 ${amount} 代币`);
                const permissionLevel = 5;
                await updateUserPermission(account, permissionLevel);
            } catch (error) {
                console.error('处理 Staked 事件时出错:', error);
            }
        });

        // 监听 Unstaked 事件
        polygonContract.on('Unstaked', async (account, amount) => {
            try {
                console.log(`检测到 Unstaked 事件: 用户 ${account} 解除了 ${amount} 质押`);
                await handleUserPermissionAndAirdropUpdate(account);
            } catch (error) {
                console.error('处理 Unstaked 事件时出错:', error);
            }
        });

        // 监听 BlacklistUpdated 事件
        polygonContract.on('BlacklistUpdated', async (account, status) => {
            try {
                console.log(`检测到 BlacklistUpdated 事件: 用户 ${account} 状态更新为 ${status}`);
                if (status === true) {
                    await handleUserPermissionAndAirdropUpdate(account);
                } else {
                    console.log(`用户 ${account} 从黑名单中移除，不进行权限和 airdrop 更新`);
                }
            } catch (error) {
                console.error('处理 BlacklistUpdated 事件时出错:', error);
            }
        });

        console.log('Polygon 事件监听器已启动...');
    } catch (error) {
        console.error('监听器启动时出错:', error);
        setTimeout(() => {
            console.log('重启事件监听器...');
            listenForEvents();
        }, 5000); // 等待5秒后重启监听器
    }
};

// 启动监听器
listenForEvents();
