/**
 * Game On Dude! SDK for Unity
 * www.gameonguy.com
 *
 * Network Identity - Component to identify networked objects.
 */

using UnityEngine;

namespace GameOn.Multiplayer
{
    public class GameOnNetworkIdentity : MonoBehaviour
    {
        public string OwnerId { get; set; }
        public bool IsLocalPlayer { get; set; }
        public bool IsMine => OwnerId == GameOnClient.Instance?.ClientId;
    }
}
